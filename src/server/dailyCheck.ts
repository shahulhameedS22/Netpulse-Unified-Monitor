/**
 * Daily check: ONE automatic round (ping + speed test for every region) and ONE summary e-mail per day.
 *
 * Triggered by Vercel Cron -> GET /api/monitor/daily (see vercel.json). Manual tests in the browser are unchanged.
 *
 * E-mail rules (Resend):
 *   - Every day exactly one normal summary e-mail: "Everything is good", or "Completed with notes".
 *   - The only RED alert is the existing critical e-mail: ALERT_CONSECUTIVE_TIMEOUTS (default 5) or more ping
 *     requests in a row timed out in one region (sent by alerts.ts, separately, as soon as it happens).
 *   - Anything else (some packet loss, an unusual value, a region that could not be tested) is only written
 *     in the normal summary e-mail.
 *
 * The speed test runs on the server (Vercel) against each regional LibreSpeed server, so the numbers show the
 * path from the app's server to that region.
 */
import crypto from 'crypto';
import { UNIFIED_ENDPOINTS, type UnifiedEndpoint } from '../config/endpoints.js';
import { REGIONS, getAnomalies, getSamples, type Sample, type StoredAnomaly } from './metricsStore.js';
import { recordSamples } from './monitoring.js';
import { alertRecipients, sendEmailViaResend, redisConfig, redisPipeline, CRITICAL_MARK_KEY } from './alerts.js';

type ProbeResult = { region: string; status: string; detail?: string };
export interface DailyDeps {
  /** one ping round for all regions (runScheduledProbes in app.ts) */
  runPings: () => Promise<ProbeResult[]>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// The e-mail is sent only AFTER every test has finished. Push agents report back after their next poll (default 30 s)
// plus the ping itself (~10 s), so we keep waiting until all results are in. DAILY_MAX_WAIT_SECONDS is only the safety
// limit (default 50 s, which fits the 60 s function limit in vercel.json); raise both together if your plan allows it.
const maxWaitMs = (): number => {
  const n = Number(process.env.DAILY_MAX_WAIT_SECONDS);
  return (Number.isFinite(n) && n >= 10 && n <= 280 ? n : 50) * 1000;
};
export const DAILY_LAST_KEY = 'daily:last';

const REGION_NAMES: Record<string, string> = {
  'IN-DC01': 'Bangalore TATA', 'IN-DC02': 'Bangalore ACT', 'LK-DC01': 'Sri Lanka', 'SG-DC01': 'Singapore',
};

/* ------------------------------ server-side speed test ------------------------------ */

const speedSeconds = (): number => {
  const n = Number(process.env.DAILY_SPEED_SECONDS);
  return Number.isFinite(n) && n >= 2 && n <= 10 ? n : 5;
};
const withRand = (url: string, extra = '') => `${url}${url.includes('?') ? '&' : '?'}${extra}r=${Math.random()}`;

async function measurePing(url: string): Promise<{ pingMs: number; jitterMs: number }> {
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    const r = await fetch(withRand(url), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    await r.arrayBuffer();
    if (!r.ok) throw new Error(`ping HTTP ${r.status}`);
    if (i > 0) times.push(performance.now() - t0); // the first request also builds the TLS connection: not counted
  }
  let jit = 0;
  for (let i = 1; i < times.length; i++) jit += Math.abs(times[i] - times[i - 1]);
  return { pingMs: Math.min(...times), jitterMs: times.length > 1 ? jit / (times.length - 1) : 0 };
}

async function measureDownload(url: string, seconds: number): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), seconds * 1000);
  const t0 = performance.now();
  let bytes = 0;
  const stream = async () => {
    while (!ctrl.signal.aborted) {
      const r = await fetch(withRand(url, 'ckSize=50&'), { cache: 'no-store', signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error(`download HTTP ${r.status}`);
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
    }
  };
  try {
    await Promise.allSettled([stream(), stream(), stream()]);
  } finally {
    clearTimeout(timer);
  }
  const secs = (performance.now() - t0) / 1000;
  return bytes > 0 ? (bytes * 8) / secs / 1e6 : 0;
}

async function measureUpload(url: string, seconds: number): Promise<number> {
  const blob = crypto.randomBytes(1024 * 1024); // 1 MB per request keeps slow links inside the time limit
  const deadline = Date.now() + seconds * 1000;
  const hardStop = AbortSignal.timeout(seconds * 1000 + 4000);
  const t0 = performance.now();
  let bytes = 0;
  const stream = async () => {
    while (Date.now() < deadline) {
      const r = await fetch(withRand(url), { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' }, cache: 'no-store', signal: hardStop });
      await r.arrayBuffer();
      if (!r.ok) throw new Error(`upload HTTP ${r.status}`);
      bytes += blob.length;
    }
  };
  await Promise.allSettled([stream(), stream()]);
  const secs = (performance.now() - t0) / 1000;
  return bytes > 0 ? (bytes * 8) / secs / 1e6 : 0;
}

async function speedForRegion(ep: UnifiedEndpoint): Promise<Sample> {
  const secs = speedSeconds();
  const p = await measurePing(ep.pingUrl);
  const down = await measureDownload(ep.downloadUrl, secs);
  const up = await measureUpload(ep.uploadUrl, secs);
  const m: Record<string, number> = { pingMs: p.pingMs, jitterMs: p.jitterMs };
  if (down > 0) m.downloadMbps = down;
  if (up > 0) m.uploadMbps = up;
  const t = Date.now();
  return { id: `speed:${ep.serverCode}:sched_${t}`, t, kind: 'speed', region: ep.serverCode, source: 'scheduled', m };
}

async function runSpeedRound(): Promise<{ samples: Map<string, Sample>; errors: Map<string, string> }> {
  const samples = new Map<string, Sample>();
  const errors = new Map<string, string>();
  await Promise.all(
    UNIFIED_ENDPOINTS.map(async (ep) => {
      try { samples.set(ep.serverCode, await speedForRegion(ep)); }
      catch (e: any) { errors.set(ep.serverCode, e?.name === 'TimeoutError' ? 'the speed server did not answer in time' : e?.message || 'speed test failed'); }
    })
  );
  if (samples.size) await recordSamples([...samples.values()]).catch((e) => console.error('[daily] could not store speed results:', e?.message || e));
  return { samples, errors };
}

/* ------------------------------ waiting for push agents ------------------------------ */

async function waitForScheduledPing(regions: string[], since: number, until: number): Promise<void> {
  while (regions.length && Date.now() < until) {
    const have = await Promise.all(
      regions.map((r) => getSamples('ping', r, since - 60_000, Date.now() + 1000, 10).then((x) => x.length > 0).catch(() => false))
    );
    if (have.every(Boolean)) return;
    await sleep(2000);
  }
}

/* ------------------------------ building the report ------------------------------ */

type Overall = 'good' | 'notes' | 'critical';
interface Row { region: string; ping: string; speed: string; status: 'ok' | 'note' | 'critical'; notes: string[] }

const f1 = (v: unknown) => (typeof v === 'number' ? v.toFixed(1) : 'n/a');

async function buildReport(since: number, pingRes: ProbeResult[], speed: Awaited<ReturnType<typeof runSpeedRound>>) {
  const from = since - 60_000;
  const anomalies: StoredAnomaly[] = await getAnomalies(from, Date.now() + 1000, 200).catch(() => []);
  const marks: Array<string | null> = redisConfig()
    ? await redisPipeline(REGIONS.map((r) => ['GET', CRITICAL_MARK_KEY(r)])).catch(() => REGIONS.map(() => null))
    : REGIONS.map(() => null);

  const rows: Row[] = [];
  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i];
    const notes: string[] = [];
    let status: Row['status'] = 'ok';

    // ping
    const ps = (await getSamples('ping', region, from, Date.now() + 1000, 20).catch(() => [] as Sample[])).sort((a, b) => b.t - a.t)[0];
    let ping = 'no result';
    if (ps) {
      ping = `avg ${f1(ps.m.avgLatencyMs)} ms, loss ${f1(ps.m.packetLossPercent ?? 0)} %`;
      if ((ps.m.packetLossPercent ?? 0) > 0) notes.push(`Ping: ${f1(ps.m.packetLossPercent)} % of requests timed out (below the critical limit of consecutive timeouts).`);
    } else {
      const pr = pingRes.find((x) => x.region === region);
      const why = pr?.status === 'agent_offline' ? 'the regional ping agent is offline'
        : pr?.status === 'queued' ? `the agent did not report back within ${Math.round(maxWaitMs() / 1000)} seconds`
        : pr?.status === 'skipped' ? (pr.detail || 'no ping source is configured for this region')
        : pr?.detail || 'no result was received';
      notes.push(`Ping was not tested: ${why}.`);
    }

    // speed
    const ss = speed.samples.get(region);
    let spd = 'no result';
    if (ss) {
      spd = `down ${f1(ss.m.downloadMbps)} / up ${f1(ss.m.uploadMbps)} Mbps, ping ${f1(ss.m.pingMs)} ms`;
      if (ss.m.downloadMbps === undefined || ss.m.uploadMbps === undefined) notes.push('Speed test: download or upload could not be measured.');
    } else {
      notes.push(`Speed test did not complete: ${speed.errors.get(region) || 'no result'}.`);
    }

    // anomalies found by this run (shown on the dashboard, never e-mailed separately)
    for (const a of anomalies.filter((x) => x.region === region)) notes.push(`Unusual value: ${a.message}`);

    if (notes.length) status = 'note';
    let mark: any = null;
    try { mark = marks[i] ? JSON.parse(marks[i] as string) : null; } catch { /* ignore */ }
    if (mark && typeof mark.t === 'number' && mark.t >= from) {
      status = 'critical';
      notes.unshift(`CRITICAL: ${mark.maxRun} ping requests in a row timed out. The red critical alert e-mail was sent for this region.`);
    }
    rows.push({ region, ping, speed: spd, status, notes });
  }
  const overall: Overall = rows.some((r) => r.status === 'critical') ? 'critical' : rows.some((r) => r.status === 'note') ? 'notes' : 'good';
  return { rows, overall };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const istDate = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

function buildMail(report: { rows: Row[]; overall: Overall }, now: Date) {
  const day = istDate(now);
  const title = report.overall === 'good' ? 'Everything is good'
    : report.overall === 'notes' ? 'Completed with notes'
    : 'Critical alert raised - please check';
  const subject = `Daily Network Check - ${day}: ${title}`;
  const dash = process.env.ALERT_DASHBOARD_URL?.trim() || '';
  const pill = report.overall === 'good' ? ['#dcfce7', '#166534'] : report.overall === 'notes' ? ['#fef3c7', '#92400e'] : ['#fee2e2', '#991b1b'];
  const intro = report.overall === 'good'
    ? 'The daily ping and speed tests finished for all four regions and everything is normal.'
    : report.overall === 'notes'
      ? 'The daily tests finished. Nothing is critical, but please note the points below.'
      : 'A critical alert (5 or more ping requests in a row timed out) was raised today. Details are below and in the separate red alert e-mail.';
  const notes = report.rows.flatMap((r) => r.notes.map((n) => `${r.region}: ${n}`));

  const text = [
    `NETWORK MONITOR - DAILY CHECK (${day})`, '', title.toUpperCase(), intro, '',
    ...report.rows.map((r) => `${r.region} (${REGION_NAMES[r.region] || ''}) - ${r.status === 'ok' ? 'OK' : r.status === 'note' ? 'NOTE' : 'CRITICAL'}\n  Ping : ${r.ping}\n  Speed: ${r.speed}`),
    ...(notes.length ? ['', 'Notes:', ...notes.map((n) => `- ${n}`)] : []),
    ...(dash ? ['', `Dashboard: ${dash}`] : []), '',
    'Automated message, sent once a day. A red critical alert is sent separately only when 5 or more ping requests in a row time out in a region.',
  ].join('\n');

  const dot = (s: Row['status']) => `<span style="color:${s === 'ok' ? '#16a34a' : s === 'note' ? '#d97706' : '#dc2626'}">&#9679;</span>`;
  const tr = report.rows.map((r, i) =>
    `<tr style="background:${i % 2 ? '#ffffff' : '#f9fafb'}"><td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:600">${dot(r.status)} ${esc(r.region)}<div style="font-weight:400;color:#6b7280;font-size:11.5px">${esc(REGION_NAMES[r.region] || '')}</div></td>` +
    `<td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">${esc(r.ping)}</td><td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">${esc(r.speed)}</td></tr>`).join('');
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;border:1px solid #e5e7eb;border-radius:6px;color:#111827">` +
    `<div style="background:#0F4761;color:#fff;padding:18px 22px"><div style="font-size:12px;letter-spacing:1px;opacity:.85">NETWORK MONITOR</div><div style="font-size:19px;font-weight:700;margin-top:4px">Daily network check - ${esc(day)}</div></div>` +
    `<div style="padding:18px 22px 6px"><span style="display:inline-block;background:${pill[0]};color:${pill[1]};font-weight:700;font-size:12px;padding:3px 10px;border-radius:12px">${esc(title.toUpperCase())}</span><p style="margin:12px 0 0;font-size:14px;line-height:1.55">${esc(intro)}</p></div>` +
    `<div style="padding:10px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-bottom:0"><tr style="background:#eef2f7"><th align="left" style="padding:8px 10px;font-size:12px">Region</th><th align="left" style="padding:8px 10px;font-size:12px">Ping</th><th align="left" style="padding:8px 10px;font-size:12px">Speed test</th></tr>${tr}</table></div>` +
    (notes.length ? `<div style="padding:4px 22px 8px"><div style="font-size:13px;font-weight:700">Notes</div><ul style="margin:6px 0 0 18px;padding:0;font-size:13px;line-height:1.55">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '') +
    (dash ? `<p style="padding:6px 22px 14px;margin:0"><a href="${esc(dash)}" style="background:#0F4761;color:#fff;padding:9px 16px;border-radius:4px;text-decoration:none;font-size:13px">Open the dashboard</a></p>` : '') +
    `<p style="padding:12px 22px;border-top:1px solid #e5e7eb;font-size:11.5px;color:#6b7280;margin:0">Automated message, sent once a day. A red critical alert is sent separately only when 5 or more ping requests in a row time out in a region.</p></div>`;
  return { subject, html, text };
}

/* ------------------------------ the daily job ------------------------------ */

export async function runDailyCheck(deps: DailyDeps, opts: { force?: boolean } = {}) {
  const since = Date.now();
  // 1. run all tests (ping + speed) and 2. wait until every region has reported. Only then the e-mail is built and sent.
  const [pingRes, speed] = await Promise.all([deps.runPings(), runSpeedRound()]);
  await waitForScheduledPing(pingRes.filter((r) => r.status === 'queued').map((r) => r.region), since, since + maxWaitMs());
  const report = await buildReport(since, pingRes, speed);
  const mail = buildMail(report, new Date());

  // exactly one summary e-mail per day (IST), even if the job is started twice; ?force=1 skips this check
  let emailStatus: string;
  const to = alertRecipients();
  if (!process.env.RESEND_API_KEY?.trim() || !to.length) {
    emailStatus = 'not_configured';
  } else {
    const dayKey = `daily:mail:${istDay(new Date())}`;
    let locked = false;
    let duplicate = false;
    if (redisConfig() && !opts.force) {
      try {
        const [set] = await redisPipeline([['SET', dayKey, '1', 'NX', 'EX', 20 * 3600]]);
        if (set === 'OK') locked = true; else duplicate = true;
      } catch { /* storage problem: better to send than to stay silent */ }
    }
    if (duplicate) {
      emailStatus = 'already_sent_today';
    } else {
      const s = await sendEmailViaResend(to, mail);
      if (s !== 'sent' && locked) await redisPipeline([['DEL', dayKey]]).catch(() => undefined); // allow a retry
      emailStatus = s;
    }
  }

  if (redisConfig()) {
    await redisPipeline([['SET', DAILY_LAST_KEY, JSON.stringify({ t: Date.now(), overall: report.overall, email: emailStatus }), 'EX', 40 * 86400]]).catch(() => undefined);
  }
  return { overall: report.overall, email: emailStatus, regions: report.rows.map((r) => ({ region: r.region, status: r.status, ping: r.ping, speed: r.speed })) };
}
