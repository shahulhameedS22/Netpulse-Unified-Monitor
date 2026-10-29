/**
 * Timeout alert EMAIL for the ping monitor (server side).
 *
 * - An email is sent only when MORE THAN ALERT_CONSECUTIVE_TIMEOUTS (default 5) ping requests in a row
 *   time out in one test, at most once per region per ALERT_EMAIL_COOLDOWN_MIN (default 30) minutes.
 * - Any timeout (even one) is flagged to the dashboard through result.alert (see buildAlert).
 * - POST /api/alerts/test-email (administrator key) sends a clearly marked TEST email.
 *
 * Environment variables:
 *   RESEND_API_KEY, ALERT_EMAIL_TO (comma separated), ALERT_EMAIL_FROM (optional),
 *   ALERT_CONSECUTIVE_TIMEOUTS (optional, default 5), ALERT_EMAIL_COOLDOWN_MIN (optional, default 30),
 *   ALERT_DASHBOARD_URL (optional, link shown in the email)
 *   Storage for the cooldown: UPSTASH_REDIS_REST_URL / _TOKEN (or KV_REST_API_URL / _TOKEN)
 */
import type { Request, Response, Router } from 'express';

export type RegionId = 'IN-DC01' | 'IN-DC02' | 'LK-DC01' | 'SG-DC01';
const FIXED_TARGET_IP = '8.8.8.8';

type RedisCmd = (string | number)[];
function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}
async function redisPipeline(cmds: RedisCmd[]): Promise<any[]> {
  const cfg = redisConfig();
  if (!cfg) throw new Error('STORAGE_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Storage HTTP ${r.status}`);
    const arr = (await r.json()) as Array<{ result?: any; error?: string }>;
    return arr.map((x) => {
      if (x.error) throw new Error(x.error);
      return x.result;
    });
  } finally {
    clearTimeout(timer);
  }
}
const mailKey = (r: string) => `ping:alertmail:${r}`;

export type AlertEmailStatus = 'not_required' | 'sent' | 'skipped_cooldown' | 'not_configured' | 'failed';
export interface PingAlert {
  level: 'none' | 'warning' | 'critical';
  timeouts: number;
  maxConsecutiveTimeouts: number;
  threshold: number;
  emailStatus: AlertEmailStatus;
}

const REGION_LABELS: Record<RegionId, string> = {
  'IN-DC01': 'IN-DC01 (Mumbai)',
  'IN-DC02': 'IN-DC02 (Chennai)',
  'LK-DC01': 'LK-DC01 (Colombo)',
  'SG-DC01': 'SG-DC01 (Singapore)',
};

function alertThreshold(): number {
  const n = Number(process.env.ALERT_CONSECUTIVE_TIMEOUTS);
  return Number.isInteger(n) && n >= 1 && n <= 29 ? n : 5;
}
function alertCooldownSeconds(): number {
  const m = Number(process.env.ALERT_EMAIL_COOLDOWN_MIN);
  return (Number.isFinite(m) && m >= 1 && m <= 1440 ? Math.round(m) : 30) * 60;
}
function alertRecipients(): string[] {
  return (process.env.ALERT_EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s))
    .slice(0, 10);
}

/** Longest run of consecutive timed-out ping requests. */
function longestTimeoutRun(packets: Array<{ sequence: number; success: boolean }>, sent: number, failed: number): number {
  if (!packets.length) return failed >= sent ? sent : failed > 0 ? 1 : 0;
  let run = 0;
  let max = 0;
  for (const p of [...packets].sort((a, b) => a.sequence - b.sequence)) {
    if (!p.success) {
      run++;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

export function buildAlert(result: any): PingAlert {
  const threshold = alertThreshold();
  const timeouts: number = result.failedRequests;
  const maxRun = longestTimeoutRun(result.packets || [], result.requestsSent, timeouts);
  const level: PingAlert['level'] = timeouts <= 0 ? 'none' : maxRun > threshold ? 'critical' : 'warning';
  return { level, timeouts, maxConsecutiveTimeouts: maxRun, threshold, emailStatus: 'not_required' };
}

const escHtml = (s: unknown) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtWhen(d: Date): string {
  const ist = d.toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  return `${ist} IST (${d.toISOString().replace('T', ' ').slice(0, 19)} UTC)`;
}
const fmtMs = (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)} ms` : 'n/a');

function buildAlertEmail(region: RegionId, result: any, alert: PingAlert, isTest = false) {
  const label = REGION_LABELS[region] || region;
  const when = fmtWhen(new Date());
  const dash = process.env.ALERT_DASHBOARD_URL?.trim() || 'https://ping-monitoring-demo-app.vercel.app';
  const cooldownMin = Math.round(alertCooldownSeconds() / 60);
  const packets: Array<{ sequence: number; success: boolean }> = [...(result.packets || [])].sort((a, b) => a.sequence - b.sequence);
  const n = alert.maxConsecutiveTimeouts;
  const subject = `${isTest ? '[TEST] ' : ''}[CRITICAL] Ping timeout alert: ${region} - ${n} consecutive requests timed out`;

  const intro =
    `Regional Ping Monitor detected ${n} consecutive ping requests that timed out from ${label} to ${FIXED_TARGET_IP}. ` +
    `This exceeds the alert threshold of ${alert.threshold} consecutive timeouts, so this notification was sent automatically.`;

  const rows: Array<[string, string]> = [
    ['Region', label],
    ['Severity', 'Critical'],
    ['Detected at', when],
    ['Ping target', FIXED_TARGET_IP],
    ['Requests sent / replies received', `${result.requestsSent} / ${result.successfulReplies}`],
    ['Requests timed out', `${alert.timeouts} (${result.packetLossPercent}% packet loss)`],
    ['Longest run of consecutive timeouts', String(n)],
    ['Latency of replies (min / avg / max)', `${fmtMs(result.minLatencyMs)} / ${fmtMs(result.avgLatencyMs)} / ${fmtMs(result.maxLatencyMs)}`],
    ['Jitter', fmtMs(result.jitterMs)],
  ];
  const actions = [
    `Confirm the issue by running "ping ${FIXED_TARGET_IP}" on the ${region} VM and by repeating the test from the dashboard.`,
    'Check the data center internet link and the status of the upstream service provider.',
    `Verify that firewall rules allow outbound ICMP (ping) to ${FIXED_TARGET_IP} from the ${region} network.`,
    'If the timeouts continue, escalate to the network team and the service provider with the details above.',
  ];

  const text = [
    isTest ? 'THIS IS A TEST MESSAGE. NO REAL INCIDENT HAS BEEN DETECTED.' : '',
    'REGIONAL PING MONITOR - CRITICAL ALERT',
    '',
    intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Packet timeline (. = reply received, X = timed out):',
    packets.map((p) => (p.success ? '.' : 'X')).join(''),
    '',
    'Recommended actions:',
    ...actions.map((a, i) => `${i + 1}. ${a}`),
    '',
    `Dashboard: ${dash}`,
    '',
    `This is an automated message from Regional Ping Monitor. To avoid repeated emails, further alerts for ${region} are suppressed for ${cooldownMin} minutes. Please do not reply to this message.`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '' )).join('\n');

  const rowHtml = rows
    .map(([k, v], i) =>
      `<tr><td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;background:${i % 2 ? '#ffffff' : '#f9fafb'};color:#374151;width:42%;font-size:13px;">${escHtml(k)}</td>` +
      `<td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;background:${i % 2 ? '#ffffff' : '#f9fafb'};color:#111827;font-size:13px;font-weight:600;">${escHtml(v)}</td></tr>`)
    .join('');
  const cells = packets
    .map((p) => `<td width="14" height="14" style="width:14px;height:14px;background:${p.success ? '#2e7d32' : '#c62828'};font-size:1px;line-height:1px;">&nbsp;</td><td width="2" style="width:2px;font-size:1px;">&nbsp;</td>`)
    .join('');
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,Helvetica,sans-serif;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 0;"><tr><td align="center">` +
    `<table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:620px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;">` +
    (isTest ? `<tr><td style="background:#fef3c7;color:#92400e;padding:10px 24px;font-size:13px;font-weight:600;">THIS IS A TEST MESSAGE. No real incident has been detected.</td></tr>` : '') +
    `<tr><td style="background:#0F4761;padding:20px 24px;color:#ffffff;"><div style="font-size:12px;letter-spacing:1px;opacity:.85;">REGIONAL PING MONITOR</div>` +
    `<div style="font-size:20px;font-weight:700;margin-top:4px;">Critical ping timeout alert: ${escHtml(label)}</div></td></tr>` +
    `<tr><td style="padding:22px 24px 8px 24px;color:#111827;font-size:14px;line-height:1.55;">` +
    `<span style="display:inline-block;background:#fee2e2;color:#991b1b;font-weight:700;font-size:12px;padding:3px 10px;border-radius:12px;">CRITICAL</span>` +
    `<p style="margin:12px 0 0 0;">${escHtml(intro)}</p></td></tr>` +
    `<tr><td style="padding:12px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-bottom:0;">${rowHtml}</table></td></tr>` +
    `<tr><td style="padding:6px 24px 4px 24px;color:#374151;font-size:13px;font-weight:700;">Packet timeline</td></tr>` +
    `<tr><td style="padding:0 24px 4px 24px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr>${cells}</tr></table></td></tr>` +
    `<tr><td style="padding:4px 24px 12px 24px;color:#6b7280;font-size:12px;"><span style="color:#2e7d32;">&#9632;</span> reply received &nbsp; <span style="color:#c62828;">&#9632;</span> request timed out (one box per ping request, in order)</td></tr>` +
    `<tr><td style="padding:6px 24px 0 24px;color:#374151;font-size:13px;font-weight:700;">Recommended actions</td></tr>` +
    `<tr><td style="padding:4px 24px 12px 24px;color:#111827;font-size:13px;line-height:1.6;"><ol style="margin:4px 0 0 18px;padding:0;">${actions.map((a) => `<li style="margin-bottom:4px;">${escHtml(a)}</li>`).join('')}</ol></td></tr>` +
    `<tr><td style="padding:8px 24px 20px 24px;"><a href="${escHtml(dash)}" style="display:inline-block;background:#0F4761;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:4px;">Open the dashboard</a></td></tr>` +
    `<tr><td style="padding:14px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11.5px;line-height:1.5;">This is an automated message from Regional Ping Monitor. To avoid repeated emails, further alerts for ${escHtml(region)} are suppressed for ${cooldownMin} minutes. Please do not reply to this message.</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { subject, html, text };
}

async function sendEmailViaResend(to: string[], mail: { subject: string; html: string; text: string }): Promise<'sent' | 'not_configured' | 'failed'> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key || !to.length) return 'not_configured';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(process.env.RESEND_API_URL?.trim() || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERT_EMAIL_FROM?.trim() || 'Regional Ping Monitor <onboarding@resend.dev>',
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      console.error('[alert] email provider returned HTTP', r.status, (await r.text()).slice(0, 200));
      return 'failed';
    }
    return 'sent';
  } catch (err: any) {
    console.error('[alert] email send failed:', err?.name === 'AbortError' ? 'timeout' : err?.message);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

/** Sends the critical email once per region per cooldown period. */
export async function sendCriticalAlertEmail(region: RegionId, result: any, alert: PingAlert): Promise<AlertEmailStatus> {
  const to = alertRecipients();
  if (!process.env.RESEND_API_KEY?.trim() || !to.length) return 'not_configured';
  let acquired = false;
  try {
    const [set] = await redisPipeline([['SET', mailKey(region), '1', 'NX', 'EX', alertCooldownSeconds()]]);
    if (set !== 'OK') return 'skipped_cooldown';
    acquired = true;
    const status = await sendEmailViaResend(to, buildAlertEmail(region, result, alert));
    if (status !== 'sent') {
      await redisPipeline([['DEL', mailKey(region)]]).catch(() => undefined); // let the next incident try again
      return status === 'not_configured' ? 'not_configured' : 'failed';
    }
    return 'sent';
  } catch (err: any) {
    console.error('[alert] could not process alert email:', err?.message);
    if (acquired) await redisPipeline([['DEL', mailKey(region)]]).catch(() => undefined);
    return 'failed';
  }
}

/** POST /api/alerts/test-email (administrator key required): sends a clearly marked TEST email. */
export function registerAlertRoutes(apiRouter: Router): void {
  apiRouter.post('/alerts/test-email', async (req: Request, res: Response) => {
    if (!(req as any).isApiKeyAuthenticated) {
      res.status(401).json({ ok: false, error: 'Administrator key required (Authorization: Bearer <CENTRAL_API_KEY>).' });
      return;
    }
    const to = alertRecipients();
    if (!process.env.RESEND_API_KEY?.trim() || !to.length) {
      res.status(503).json({ ok: false, error: 'Email is not configured: set RESEND_API_KEY and ALERT_EMAIL_TO.' });
      return;
    }
    const packets = Array.from({ length: 30 }, (_, i) => ({ sequence: i + 1, success: !(i >= 8 && i <= 15) }));
    const sample = {
      requestsSent: 30, successfulReplies: 22, failedRequests: 8, packetLossPercent: 26.7,
      minLatencyMs: 39.1, avgLatencyMs: 39.4, maxLatencyMs: 41.2, jitterMs: 0.4, packets,
    };
    const alert: PingAlert = { level: 'critical', timeouts: 8, maxConsecutiveTimeouts: 8, threshold: alertThreshold(), emailStatus: 'not_required' };
    const status = await sendEmailViaResend(to, buildAlertEmail('IN-DC02', sample, alert, true));
    res.status(status === 'sent' ? 200 : 502).json({ ok: status === 'sent', status, sentTo: to.length });
  });
}
