/**
 * Network monitoring layer: stores history, detects anomalies, compares periods, sends alerts.
 *
 * Routes (all under /api, same auth rules as the rest of the API):
 *   POST /metrics/ingest                 browser sends a finished ping/speed session -> stored + checked
 *   GET  /metrics/history                trend data (bucketed) for charts
 *   GET  /metrics/compare                current period vs previous period (or vs same period last week)
 *   GET  /metrics/anomalies              detected anomalies (open / acknowledged)
 *   POST /metrics/anomalies/:id/ack      acknowledge an anomaly
 *   GET  /metrics/export.csv             raw history download
 *   GET  /monitor/config                 thresholds, storage mode, scheduler status
 *   GET|POST /monitor/run                run one scheduled probe round (needs CENTRAL_API_KEY or CRON_SECRET)
 */
import type { Request, Response, Router } from 'express';
import crypto from 'crypto';
import {
  addAnomaly, addSample, ackAnomaly, getAckedIds, getAnomalies, getSamples, pruneOld, storageInfo, retentionDays, REGIONS,
  type MetricKind, type Sample, type StoredAnomaly,
} from './metricsStore.js';
import { METRICS, bucketSeries, comparePeriods, detectAnomalies, detectorConfig } from './anomaly.js';
import { sendEmailViaResend, alertRecipients } from './alerts.js';

const isRegion = (r: unknown): r is string => typeof r === 'string' && (REGIONS as readonly string[]).includes(r);
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/* ---------------------- turning a session into samples ---------------------- */

export function samplesFromPingSession(session: any, source: Sample['source'] = 'manual'): Sample[] {
  if (!session || typeof session !== 'object' || session.isSimulated === true) return [];
  const out: Sample[] = [];
  const regions = session.regions && typeof session.regions === 'object' ? session.regions : {};
  for (const [rid, r] of Object.entries<any>(regions)) {
    if (!isRegion(rid) || !r) continue;
    // only real measurements: skip "Not Tested", "Running" and "Unavailable" (agent offline = no measurement)
    if (!['Success', 'Partial Loss', 'Failed'].includes(r.status)) continue;
    if (!finite(r.requestsSent, 1, 1000)) continue;
    const t = Date.parse(r.completedAt || session.completedAt || session.startedAt);
    if (!Number.isFinite(t)) continue;
    const m: Record<string, number> = {};
    if (finite(r.packetLossPercent, 0, 100)) m.packetLossPercent = r.packetLossPercent;
    if (finite(r.avgLatencyMs, 0, 60_000)) m.avgLatencyMs = r.avgLatencyMs;
    if (finite(r.jitterMs, 0, 60_000)) m.jitterMs = r.jitterMs;
    if (Object.keys(m).length === 0) continue;
    out.push({ id: `ping:${rid}:${session.id || t}`, t, kind: 'ping', region: rid, source, m });
  }
  return out;
}

export function samplesFromSpeedSession(session: any, source: Sample['source'] = 'manual'): Sample[] {
  if (!session || typeof session !== 'object') return [];
  const out: Sample[] = [];
  const regions = session.regions && typeof session.regions === 'object' ? session.regions : {};
  for (const r of Object.values<any>(regions)) {
    if (!r || r.status !== 'completed' || !isRegion(r.serverCode)) continue;
    const t = Date.parse(session.completedAt || session.startedAt);
    if (!Number.isFinite(t)) continue;
    const m: Record<string, number> = {};
    if (finite(r.downloadMbps, 0.001, 100_000)) m.downloadMbps = r.downloadMbps; // 0 means "not measured"
    if (finite(r.uploadMbps, 0.001, 100_000)) m.uploadMbps = r.uploadMbps;
    if (finite(r.pingMs, 0, 60_000)) m.pingMs = r.pingMs;
    if (finite(r.jitterMs, 0, 60_000)) m.jitterMs = r.jitterMs;
    if (Object.keys(m).length === 0) continue;
    out.push({ id: `speed:${r.serverCode}:${session.id || t}`, t, kind: 'speed', region: r.serverCode, source, m });
  }
  return out;
}

/** Converts one finished ping result (from a scheduled probe / agent) into a sample. */
export function sampleFromPingResult(regionId: string, result: any, source: Sample['source']): Sample | null {
  if (!isRegion(regionId) || !result || !finite(result.requestsSent, 1, 1000)) return null;
  const t = Date.parse(result.timestamp) || Date.now();
  const m: Record<string, number> = {};
  if (finite(result.packetLossPercent, 0, 100)) m.packetLossPercent = result.packetLossPercent;
  else if (finite(result.failedRequests, 0, 1000)) m.packetLossPercent = Math.round((result.failedRequests / result.requestsSent) * 1000) / 10;
  if (finite(result.avgLatencyMs, 0, 60_000)) m.avgLatencyMs = result.avgLatencyMs;
  if (finite(result.jitterMs, 0, 60_000)) m.jitterMs = result.jitterMs;
  if (Object.keys(m).length === 0) return null;
  return { id: `ping:${regionId}:sched_${t}`, t, kind: 'ping', region: regionId, source, m };
}

/* ---------------------- record + detect + notify ---------------------- */

const emailCooldownMs = () => {
  const n = Number(process.env.ANOMALY_EMAIL_COOLDOWN_MIN);
  return (Number.isFinite(n) && n >= 1 && n <= 1440 ? n : 60) * 60_000;
};
const emailMinSeverity = (): 'warning' | 'critical' => (process.env.ANOMALY_EMAIL_MIN_SEVERITY === 'warning' ? 'warning' : 'critical');

export async function recordSamples(samples: Sample[]): Promise<StoredAnomaly[]> {
  if (!samples.length) return [];
  const cfg = detectorConfig();
  const found: StoredAnomaly[] = [];
  const recent = await getAnomalies(Date.now() - 24 * 3_600_000, Date.now() + 1000, 500).catch(() => [] as StoredAnomaly[]);

  for (const s of samples) {
    // baseline = what this region looked like BEFORE this measurement
    const baseline = await getSamples(s.kind, s.region, s.t - cfg.lookbackDays * 86_400_000, s.t - 1, 2000);
    await addSample(s);
    for (const a of detectAnomalies(s, baseline, cfg)) {
      if (recent.some((x) => x.id === a.id)) continue; // the same session was sent twice: do not alert twice
      // e-mail only if nothing was e-mailed for this region+metric within the cool-down
      const wanted = a.severity === 'critical' || emailMinSeverity() === 'warning';
      const coolingDown = [...recent, ...found].some(
        (x) => x.region === a.region && x.metric === a.metric && x.emailStatus === 'sent' && Date.now() - x.t < emailCooldownMs()
      );
      a.emailStatus = wanted ? (coolingDown ? 'skipped_cooldown' : 'pending') : 'not_required';
      found.push(a);
    }
  }

  // one e-mail per call, listing every anomaly that needs one
  const toMail = found.filter((a) => a.emailStatus === 'pending');
  if (toMail.length) {
    const status = await sendAnomalyEmail(toMail);
    for (const a of toMail) a.emailStatus = status;
  }
  for (const a of found) await addAnomaly(a);

  if (Math.random() < 0.05) pruneOld().catch(() => undefined); // retention clean-up, now and then
  return found;
}

async function sendAnomalyEmail(items: StoredAnomaly[]): Promise<string> {
  const to = alertRecipients();
  if (!process.env.RESEND_API_KEY?.trim() || !to.length) return 'not_configured';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dash = process.env.ALERT_DASHBOARD_URL?.trim() || '';
  const worst = items.some((i) => i.severity === 'critical') ? 'CRITICAL' : 'WARNING';
  const regions = [...new Set(items.map((i) => i.region))].join(', ');
  const subject = `[${worst}] Network anomaly detected: ${regions}`;
  const lines = items.map((i) => `- [${i.severity.toUpperCase()}] ${i.message}`);
  const text = [
    'NETWORK MONITOR - ANOMALY ALERT', '', ...lines, '',
    'These values differ strongly from what this region normally shows (see the Monitoring tab for the history).',
    dash ? `Dashboard: ${dash}` : '',
    `Further e-mails for the same region and metric are suppressed for ${Math.round(emailCooldownMs() / 60000)} minutes.`,
  ].filter(Boolean).join('\n');
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #e5e7eb;border-radius:6px">` +
    `<div style="background:#0F4761;color:#fff;padding:18px 22px"><div style="font-size:12px;letter-spacing:1px;opacity:.85">NETWORK MONITOR</div>` +
    `<div style="font-size:19px;font-weight:700;margin-top:4px">Anomaly detected (${worst})</div></div>` +
    `<ul style="padding:16px 22px 4px 38px;line-height:1.55;font-size:14px;color:#111827">` +
    items.map((i) => `<li style="margin-bottom:8px"><b style="color:${i.severity === 'critical' ? '#b91c1c' : '#b45309'}">${i.severity.toUpperCase()}</b> - ${esc(i.message)}</li>`).join('') +
    `</ul><p style="padding:0 22px 6px;font-size:13px;color:#374151">These values differ strongly from what the region normally shows.</p>` +
    (dash ? `<p style="padding:0 22px 16px"><a href="${esc(dash)}" style="background:#0F4761;color:#fff;padding:9px 16px;border-radius:4px;text-decoration:none;font-size:13px">Open the dashboard</a></p>` : '') +
    `<p style="padding:12px 22px;border-top:1px solid #e5e7eb;font-size:11.5px;color:#6b7280;margin:0">Automated message. Further e-mails for the same region and metric are suppressed for ${Math.round(emailCooldownMs() / 60000)} minutes.</p></div>`;
  return sendEmailViaResend(to, { subject, html, text });
}

/* ---------------------- routes ---------------------- */

const RANGE_MS: Record<string, number> = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, '90d': 90 * 86_400_000 };
const parseKind = (v: unknown): MetricKind | null => (v === 'ping' || v === 'speed' ? v : null);

export interface SchedulerState {
  intervalMin: number | null;
  lastRunAt: number | null;
  lastResult: Array<{ region: string; status: string; detail?: string }> | null;
}
export const schedulerState: SchedulerState = { intervalMin: null, lastRunAt: null, lastResult: null };

export interface MonitoringDeps {
  /** runs one probe round for all regions (implemented in app.ts, which owns the regional connections) */
  runProbes: () => Promise<Array<{ region: string; status: string; detail?: string }>>;
  safeCompare: (a: string, b: string) => boolean;
  rateLimiter: (req: Request, res: Response, next: () => void) => void;
}

export function registerMonitoringRoutes(router: Router, deps: MonitoringDeps): void {
  const fail = (res: Response, err: any) => {
    console.error('[monitoring]', err?.message || err);
    res.status(503).json({ ok: false, error: 'History storage is temporarily unavailable.' });
  };

  router.get('/monitor/config', deps.rateLimiter, (_req, res) => {
    const c = detectorConfig();
    res.json({
      ok: true,
      storage: storageInfo(),
      detector: c,
      metrics: METRICS,
      regions: REGIONS,
      email: { configured: Boolean(process.env.RESEND_API_KEY?.trim() && alertRecipients().length), minSeverity: emailMinSeverity(), cooldownMin: Math.round(emailCooldownMs() / 60000) },
      scheduler: schedulerState,
    });
  });

  router.post('/metrics/ingest', deps.rateLimiter, async (req, res) => {
    const kind = parseKind(req.body?.kind);
    if (!kind) { res.status(400).json({ ok: false, error: 'kind must be "ping" or "speed".' }); return; }
    const samples = kind === 'ping' ? samplesFromPingSession(req.body?.session) : samplesFromSpeedSession(req.body?.session);
    try {
      const anomalies = await recordSamples(samples);
      res.json({ ok: true, stored: samples.length, anomalies });
    } catch (e) { fail(res, e); }
  });

  router.get('/metrics/history', deps.rateLimiter, async (req, res) => {
    const kind = parseKind(req.query.kind) || 'ping';
    const metric = String(req.query.metric || Object.keys(METRICS[kind])[0]);
    if (!METRICS[kind][metric]) { res.status(400).json({ ok: false, error: 'Unknown metric.' }); return; }
    const region = isRegion(req.query.region) ? (req.query.region as string) : 'all';
    const span = RANGE_MS[String(req.query.range)] || RANGE_MS['24h'];
    const to = Date.now();
    const from = to - span;
    const bucketMs = Math.max(60_000, Math.round(span / 72 / 60_000) * 60_000); // ~72 points per line
    try {
      const samples = await getSamples(kind, region, from, to);
      const anomalies = (await getAnomalies(from, to)).filter((a) => a.kind === kind && a.metric === metric && (region === 'all' || a.region === region));
      res.json({ ok: true, kind, metric, def: METRICS[kind][metric], from, to, bucketMs, sampleCount: samples.length, series: bucketSeries(samples, metric, from, to, bucketMs), anomalies });
    } catch (e) { fail(res, e); }
  });

  router.get('/metrics/compare', deps.rateLimiter, async (req, res) => {
    const kind = parseKind(req.query.kind) || 'ping';
    const span = RANGE_MS[String(req.query.range)] || RANGE_MS['24h'];
    const mode = req.query.mode === 'lastweek' ? 'lastweek' : 'previous';
    const region = isRegion(req.query.region) ? (req.query.region as string) : 'all';
    const now = Date.now();
    const current = { from: now - span, to: now };
    const shift = mode === 'lastweek' ? 7 * 86_400_000 : span;
    const previous = { from: current.from - shift, to: current.to - shift };
    try {
      const samples = await getSamples(kind, region, previous.from, now, 8000);
      const regions = region === 'all' ? [...REGIONS] : [region];
      res.json({ ok: true, kind, mode, current, previous, rows: comparePeriods(samples, kind, regions, current, previous) });
    } catch (e) { fail(res, e); }
  });

  router.get('/metrics/anomalies', deps.rateLimiter, async (req, res) => {
    const span = RANGE_MS[String(req.query.range)] || RANGE_MS['7d'];
    const from = Date.now() - span;
    try {
      const [list, acked] = await Promise.all([getAnomalies(from, Date.now() + 1000), getAckedIds(from)]);
      const items = list.map((a) => ({ ...a, acknowledged: acked.has(a.id) })).sort((a, b) => b.t - a.t);
      res.json({ ok: true, openCount: items.filter((i) => !i.acknowledged).length, items });
    } catch (e) { fail(res, e); }
  });

  router.post('/metrics/anomalies/:id/ack', deps.rateLimiter, async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^an_[A-Za-z0-9_.:-]{3,200}$/.test(id)) { res.status(400).json({ ok: false, error: 'Invalid anomaly id.' }); return; }
    try { await ackAnomaly(id); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  router.get('/metrics/export.csv', deps.rateLimiter, async (req, res) => {
    const kind = parseKind(req.query.kind) || 'ping';
    const span = RANGE_MS[String(req.query.range)] || RANGE_MS['30d'];
    try {
      const samples = await getSamples(kind, 'all', Date.now() - span, Date.now(), 20000);
      const cols = Object.keys(METRICS[kind]);
      const lines = ['timestamp_utc,region,source,' + cols.join(',')];
      for (const s of samples) lines.push([new Date(s.t).toISOString(), s.region, s.source, ...cols.map((c) => (typeof s.m[c] === 'number' ? s.m[c] : ''))].join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="netpulse-${kind}-history.csv"`);
      res.send(lines.join('\n'));
    } catch (e) { fail(res, e); }
  });

  // One scheduled probe round. Allowed for the administrator key OR the Vercel cron secret.
  const runHandler = async (req: Request, res: Response) => {
    const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : '';
    const cron = process.env.CRON_SECRET?.trim();
    const ok = (req as any).isApiKeyAuthenticated === true || (cron && bearer && deps.safeCompare(bearer, cron));
    if (!ok) { res.status(401).json({ ok: false, error: 'Administrator key or CRON_SECRET required.' }); return; }
    try {
      const result = await deps.runProbes();
      res.json({ ok: true, result });
    } catch (e: any) { res.status(500).json({ ok: false, error: e?.message || 'Probe round failed.' }); }
  };
  router.get('/monitor/run', runHandler);
  router.post('/monitor/run', runHandler);
}
