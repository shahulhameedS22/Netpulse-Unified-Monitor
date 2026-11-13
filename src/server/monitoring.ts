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
 *   GET|POST /monitor/daily              daily job: ping + speed for all regions, then ONE summary e-mail
 */
import type { Request, Response, Router } from 'express';
import crypto from 'crypto';
import {
  addAnomaly, addSample, ackAnomaly, getAckedIds, getAnomalies, getSamples, pruneOld, storageInfo, retentionDays, firstSampleTime, REGIONS,
  type MetricKind, type Sample, type StoredAnomaly,
} from './metricsStore.js';
import { METRICS, alertLimits, baselineInfo, bucketSeries, comparePeriods, detectAnomalies, detectionStatus, detectorConfig } from './anomaly.js';
import { sendEmailViaResend, alertRecipients, getLastEmailError, redisConfig, redisPipeline } from './alerts.js';

const maskEmail = (e: string): string => {
  const [name, domain] = e.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
};
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
      // Anomalies are shown on the dashboard and listed in the daily summary e-mail. They are NOT e-mailed on their own:
      // the only separate (red) e-mail is the critical ping-timeout alert in alerts.ts.
      a.emailStatus = 'not_required';
      found.push(a);
    }
  }

  for (const a of found) await addAnomaly(a);

  if (Math.random() < 0.05) pruneOld().catch(() => undefined); // retention clean-up, now and then
  return found;
}

/* ---------------------- routes ---------------------- */

const RANGE_MS: Record<string, number> = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, '90d': 90 * 86_400_000 };
const MAX_CUSTOM_SPAN_MS = 400 * 86_400_000;
const parseKind = (v: unknown): MetricKind | null => (v === 'ping' || v === 'speed' ? v : null);

interface TimeWindow { from: number; to: number; span: number; custom: boolean }

/**
 * Reads the period the user picked: either a preset (?range=24h) or a custom period (?from=...&to=... in epoch ms).
 * Returns an error text when the custom period is not valid.
 */
function parseWindow(query: Request['query'], defaultRange: string): TimeWindow | string {
  const now = Date.now();
  const f = Number(query.from);
  const t = Number(query.to);
  if (query.from !== undefined && query.to !== undefined && Number.isFinite(f) && Number.isFinite(t)) {
    const to = Math.min(t, now);
    if (f >= to) return 'The start of the period must be before its end.';
    if (to - f < 10 * 60_000) return 'The period must be at least 10 minutes long.';
    if (to - f > MAX_CUSTOM_SPAN_MS) return 'The period can be at most 400 days long.';
    return { from: f, to, span: to - f, custom: true };
  }
  const span = RANGE_MS[String(query.range)] || RANGE_MS[defaultRange];
  return { from: now - span, to: now, span, custom: false };
}

export interface SchedulerState {
  intervalMin: number | null;
  lastRunAt: number | null;
  lastResult: Array<{ region: string; status: string; detail?: string }> | null;
}
export const schedulerState: SchedulerState = { intervalMin: null, lastRunAt: null, lastResult: null };

export interface MonitoringDeps {
  /** runs one probe round for all regions (implemented in app.ts, which owns the regional connections) */
  runProbes: () => Promise<Array<{ region: string; status: string; detail?: string }>>;
  /** the daily job: ping + speed for all regions, then ONE summary e-mail (implemented in dailyCheck.ts) */
  runDaily: (opts: { force: boolean }) => Promise<unknown>;
  safeCompare: (a: string, b: string) => boolean;
  rateLimiter: (req: Request, res: Response, next: () => void) => void;
}

export function registerMonitoringRoutes(router: Router, deps: MonitoringDeps): void {
  const fail = (res: Response, err: any) => {
    console.error('[monitoring]', err?.message || err);
    res.status(503).json({ ok: false, error: 'History storage is temporarily unavailable.' });
  };

  router.get('/monitor/config', deps.rateLimiter, async (_req, res) => {
    const c = detectorConfig();
    let daily: { lastRunAt: number; overall: string; email: string } | null = null;
    if (redisConfig()) {
      try {
        const [raw] = await redisPipeline([['GET', 'daily:last']]);
        const d = raw ? JSON.parse(raw) : null;
        if (d && typeof d.t === 'number') daily = { lastRunAt: d.t, overall: String(d.overall), email: String(d.email) };
      } catch { /* the status badge just stays empty */ }
    }
    res.json({
      daily,
      ok: true,
      storage: storageInfo(),
      detector: c,
      metrics: METRICS,
      regions: REGIONS,
      email: {
        configured: Boolean(process.env.RESEND_API_KEY?.trim() && alertRecipients().length),
        apiKeySet: Boolean(process.env.RESEND_API_KEY?.trim()),
        recipients: alertRecipients().map(maskEmail),
        sender: process.env.ALERT_EMAIL_FROM?.trim() || null, // null = Resend's shared test sender (cannot send to your own domain)
        minSeverity: emailMinSeverity(),
        cooldownMin: Math.round(emailCooldownMs() / 60000),
      },
      scheduler: schedulerState,
    });
  });

  // Sends a clearly marked TEST e-mail to the configured recipients (never to any other address).
  // Limited to one per 30 seconds so it cannot be used to flood the team.
  let lastTestEmailAt = 0;
  router.post('/monitor/test-email', deps.rateLimiter, async (_req, res) => {
    const to = alertRecipients();
    if (!process.env.RESEND_API_KEY?.trim()) { res.status(400).json({ ok: false, error: 'RESEND_API_KEY is not set on the server.' }); return; }
    if (!to.length) { res.status(400).json({ ok: false, error: 'ALERT_EMAIL_TO is empty or has no valid e-mail address.' }); return; }
    if (Date.now() - lastTestEmailAt < 30_000) { res.status(429).json({ ok: false, error: 'Please wait 30 seconds before sending another test e-mail.' }); return; }
    lastTestEmailAt = Date.now();
    const dash = process.env.ALERT_DASHBOARD_URL?.trim() || '';
    const when = new Date().toUTCString();
    const status = await sendEmailViaResend(to, {
      subject: '[TEST] Network Monitor e-mail alerts are working',
      text: `This is a TEST e-mail from the Network Monitor.\n\nIf you can read this, anomaly alerts will reach you.\nSent: ${when}\n${dash ? `Dashboard: ${dash}\n` : ''}`,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e7eb;border-radius:6px"><div style="background:#0F4761;color:#fff;padding:18px 22px"><div style="font-size:12px;letter-spacing:1px;opacity:.85">NETWORK MONITOR</div><div style="font-size:19px;font-weight:700;margin-top:4px">Test e-mail</div></div><p style="padding:16px 22px 4px;font-size:14px;color:#111827">This is a <b>test</b>. If you can read this, anomaly alerts will reach you.</p><p style="padding:0 22px 16px;font-size:12px;color:#6b7280">Sent: ${when}</p></div>`,
    });
    if (status === 'sent') { res.json({ ok: true, sentTo: to.map(maskEmail) }); return; }
    res.status(502).json({ ok: false, error: getLastEmailError() || 'The e-mail could not be sent.' });
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
    const w = parseWindow(req.query, '24h');
    if (typeof w === 'string') { res.status(400).json({ ok: false, error: w }); return; }
    const bucketMs = Math.max(60_000, Math.round(w.span / 72 / 60_000) * 60_000); // ~72 points per line
    try {
      const cfg = detectorConfig();
      const [samples, anomalies, first] = await Promise.all([
        getSamples(kind, region, w.from, w.to),
        getAnomalies(w.from, w.to),
        firstSampleTime(kind, region),
      ]);
      // For a single region also return the "normal" value and where alerts start, so the chart can draw them
      let limits: { normal: number; warning: number; critical: number } | null = null;
      if (region !== 'all') {
        const recent = await getSamples(kind, region, Date.now() - cfg.lookbackDays * 86_400_000, Date.now(), 2000);
        const info = baselineInfo(recent.filter((x) => typeof x.m[metric] === 'number').map((x) => x.m[metric]), METRICS[kind][metric], cfg);
        if (info) { const l = alertLimits(info, METRICS[kind][metric]); limits = { normal: info.base, warning: l.warning, critical: l.critical }; }
      }
      res.json({
        ok: true, kind, metric, def: METRICS[kind][metric], from: w.from, to: w.to, bucketMs, custom: w.custom,
        sampleCount: samples.length, firstSampleAt: first, limits,
        series: bucketSeries(samples, metric, w.from, w.to, bucketMs),
        anomalies: anomalies.filter((a) => a.kind === kind && a.metric === metric && (region === 'all' || a.region === region)),
      });
    } catch (e) { fail(res, e); }
  });

  router.get('/metrics/compare', deps.rateLimiter, async (req, res) => {
    const kind = parseKind(req.query.kind) || 'ping';
    const region = isRegion(req.query.region) ? (req.query.region as string) : 'all';
    const w = parseWindow(req.query, '24h');
    if (typeof w === 'string') { res.status(400).json({ ok: false, error: w }); return; }
    let mode: 'previous' | 'lastweek' = req.query.mode === 'lastweek' ? 'lastweek' : 'previous';
    let modeNote: string | null = null;
    if (mode === 'lastweek' && w.span > 7 * 86_400_000) {
      mode = 'previous';
      modeNote = 'Comparing with last week only works for periods up to 7 days, so the period right before was used instead.';
    }
    const current = { from: w.from, to: w.to };
    const shift = mode === 'lastweek' ? 7 * 86_400_000 : w.span;
    const previous = { from: current.from - shift, to: current.to - shift };
    try {
      const [samples, first] = await Promise.all([getSamples(kind, region, previous.from, w.to, 8000), firstSampleTime(kind, region)]);
      const regions = region === 'all' ? [...REGIONS] : [region];
      const rows = comparePeriods(samples, kind, regions, current, previous);
      res.json({
        ok: true, kind, mode, modeNote, current, previous, rows,
        firstSampleAt: first,
        currentHasData: rows.some((r) => r.current),
        previousHasData: rows.some((r) => r.previous),
      });
    } catch (e) { fail(res, e); }
  });

  // Is the detector active for each region/metric, what is "normal", where does an alert start?
  router.get('/metrics/status', deps.rateLimiter, async (req, res) => {
    const kind = parseKind(req.query.kind) || 'ping';
    const region = isRegion(req.query.region) ? (req.query.region as string) : 'all';
    const cfg = detectorConfig();
    try {
      const samples = await getSamples(kind, region, Date.now() - cfg.lookbackDays * 86_400_000, Date.now(), 2000);
      const regions = region === 'all' ? [...REGIONS] : [region];
      res.json({ ok: true, kind, rows: detectionStatus(samples, kind, regions, cfg) });
    } catch (e) { fail(res, e); }
  });

  router.get('/metrics/anomalies', deps.rateLimiter, async (req, res) => {
    const w = parseWindow(req.query, '7d');
    if (typeof w === 'string') { res.status(400).json({ ok: false, error: w }); return; }
    try {
      const [list, acked] = await Promise.all([getAnomalies(w.from, w.to), getAckedIds(w.from)]);
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
    const w = parseWindow(req.query, '30d');
    if (typeof w === 'string') { res.status(400).json({ ok: false, error: w }); return; }
    try {
      const samples = await getSamples(kind, 'all', w.from, w.to, 20000);
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

  // The daily job (Vercel Cron calls GET /api/monitor/daily with "Authorization: Bearer <CRON_SECRET>").
  // ?force=1 sends the summary e-mail even if one was already sent today (for testing).
  const dailyHandler = async (req: Request, res: Response) => {
    const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : '';
    const cron = process.env.CRON_SECRET?.trim();
    const ok = (req as any).isApiKeyAuthenticated === true || (cron && bearer && deps.safeCompare(bearer, cron));
    if (!ok) { res.status(401).json({ ok: false, error: 'Administrator key or CRON_SECRET required.' }); return; }
    try {
      res.json({ ok: true, ...(await deps.runDaily({ force: req.query.force === '1' })) as object });
    } catch (e: any) { res.status(500).json({ ok: false, error: e?.message || 'Daily check failed.' }); }
  };
  router.get('/monitor/daily', dailyHandler);
  router.post('/monitor/daily', dailyHandler);
}
