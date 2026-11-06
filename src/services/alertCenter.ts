/**
 * In-app ping timeout alerts.
 *
 * - publishPingAlert() is called by regionalApi.ts whenever a test result contains at least one
 *   timed-out ping request (even a single one).
 * - Alerts appear in the top-right corner and stay until they are dismissed (they also survive a
 *   page reload). The panel mounts itself, so no change to the dashboard layout is needed.
 * - Written without JSX and with inline styles so it works with any React 18+ / Vite setup.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';

export type AlertEmailStatus = 'not_required' | 'sent' | 'skipped_cooldown' | 'not_configured' | 'failed';

export interface PublishPingAlertInput {
  regionId: string;
  timeouts: number;           // ping requests that timed out
  total: number;              // ping requests sent
  maxConsecutive: number;     // longest run of consecutive timeouts
  packetLossPercent?: number;
  level?: 'warning' | 'critical';
  threshold?: number;         // email is sent when this many (or more) timeouts happen in a row (default 5)
  emailStatus?: AlertEmailStatus;
}

interface AlertItem {
  id: string;
  level: 'warning' | 'critical';
  regionId: string;
  title: string;
  message: string;
  emailNote: string | null;
  timeouts: number;
  total: number;
  at: string;
}

const STORAGE_KEY = 'ping_alerts_v1';
const ROOT_ID = 'ping-alert-center-root';
const MAX_ITEMS = 20;

let items: AlertItem[] = load();
const listeners = new Set<() => void>();

function load(): AlertItem[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}
function persist(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage may be unavailable; the alert still shows */
  }
}
function emit(): void {
  listeners.forEach((l) => l());
}

function emailNoteFor(level: 'warning' | 'critical', status?: AlertEmailStatus): string | null {
  if (level !== 'critical') return null;
  switch (status) {
    case 'sent': return 'An email notification has been sent to the operations team.';
    case 'skipped_cooldown': return 'An email was already sent recently for this region, so no new email was sent.';
    case 'not_configured': return 'Email notification is not configured on the server.';
    case 'failed': return 'The email notification could not be sent. Please check the email settings.';
    default: return null;
  }
}

export function publishPingAlert(input: PublishPingAlertInput): void {
  if (!input || !(input.timeouts > 0)) return;
  const threshold = input.threshold ?? 5;
  const level: 'warning' | 'critical' = input.level ?? (input.maxConsecutive >= threshold ? 'critical' : 'warning');
  const loss = typeof input.packetLossPercent === 'number' ? input.packetLossPercent : Math.round((input.timeouts / Math.max(1, input.total)) * 1000) / 10;
  const item: AlertItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    regionId: input.regionId,
    title: level === 'critical'
      ? `CRITICAL: ${input.maxConsecutive} consecutive ping timeouts`
      : `Ping timeout alert: ${input.timeouts} request${input.timeouts === 1 ? '' : 's'} timed out`,
    message: `${input.timeouts} of ${input.total} ping requests to 8.8.8.8 timed out (${loss}% packet loss). Longest run of consecutive timeouts: ${input.maxConsecutive}.`,
    emailNote: level === 'critical'
      ? emailNoteFor(level, input.emailStatus)
      : `An email is sent automatically when ${threshold} or more timeouts happen in a row.`,
    timeouts: input.timeouts,
    total: input.total,
    at: new Date().toISOString(),
  };
  // The same result can be reported twice (by the dashboard code and by the watcher below): show it once.
  const now = Date.parse(item.at);
  if (items.some((i) => i.regionId === item.regionId && i.message === item.message && now - Date.parse(i.at) < 8000)) return;
  items = [item, ...items].slice(0, MAX_ITEMS);
  persist();
  emit();
  ensureMounted();
}

/** Anomaly found by the history-based detector (server side): shown in the same panel as ping timeout alerts. */
export function publishAnomalyAlert(input: {
  regionId: string; level: 'warning' | 'critical'; title: string; message: string; emailStatus?: string;
}): void {
  const at = new Date().toISOString();
  const emailNote =
    input.emailStatus === 'sent' ? 'An email notification has been sent to the operations team.' :
    input.emailStatus === 'skipped_cooldown' ? 'An email was already sent recently for this region and metric.' :
    input.emailStatus === 'failed' ? 'The email notification could not be sent. Please check the email settings.' : null;
  const item: AlertItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level: input.level, regionId: input.regionId,
    title: `${input.level === 'critical' ? 'CRITICAL anomaly' : 'Anomaly'}: ${input.title}`,
    message: input.message, emailNote, timeouts: 0, total: 0, at,
  };
  if (items.some((i) => i.regionId === item.regionId && i.message === item.message)) return;
  items = [item, ...items].slice(0, MAX_ITEMS);
  persist();
  emit();
  ensureMounted();
}

function dismiss(id: string): void {
  items = items.filter((i) => i.id !== id);
  persist();
  emit();
}
function dismissAll(): void {
  items = [];
  persist();
  emit();
}

const h = React.createElement;
const PALETTE = {
  warning: { border: '#d97706', bg: '#fffbeb', title: '#92400e', chip: '#d97706', icon: '\u26A0' },
  critical: { border: '#dc2626', bg: '#fef2f2', title: '#991b1b', chip: '#dc2626', icon: '\u26D4' },
};

const STYLE_ID = 'ping-alert-center-style';
function injectStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent =
    '@keyframes pingAlertIn{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}' +
    '@keyframes pingAlertPulse{0%,100%{box-shadow:0 6px 22px rgba(220,38,38,.35)}50%{box-shadow:0 6px 30px rgba(220,38,38,.75)}}';
  document.head.appendChild(el);
}

function AlertCenter(): React.ReactElement | null {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  if (items.length === 0) return null;

  const closeBtn = (onClick: () => void, label: string) =>
    h('button', {
      type: 'button', onClick, 'aria-label': label, title: label,
      style: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#6b7280', padding: 2 },
    }, '\u00D7');

  return h('div', {
    role: 'region', 'aria-label': 'Ping alerts',
    style: {
      position: 'fixed', top: 16, right: 16, width: 430, maxWidth: 'calc(100vw - 32px)', maxHeight: '88vh',
      overflowY: 'auto', zIndex: 2147483000, display: 'flex', flexDirection: 'column', gap: 12,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    },
  },
    items.length > 1 && h('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111827', color: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 600 },
    },
      h('span', null, `${items.length} active ping alerts`),
      h('button', { type: 'button', onClick: dismissAll, style: { background: 'transparent', color: '#fff', border: '1px solid #9ca3af', borderRadius: 6, padding: '3px 12px', cursor: 'pointer', fontSize: 13 } }, 'Dismiss all'),
    ),
    ...items.map((a) => {
      const c = PALETTE[a.level];
      return h('div', {
        key: a.id, role: 'alert',
        style: {
          background: c.bg, borderLeft: `8px solid ${c.border}`, borderRadius: 10, padding: '14px 16px', color: '#111827',
          boxShadow: '0 6px 22px rgba(0,0,0,.35)',
          animation: a.level === 'critical' ? 'pingAlertIn .35s ease-out, pingAlertPulse 1.8s ease-in-out 3' : 'pingAlertIn .35s ease-out',
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { background: c.chip, color: '#fff', fontWeight: 800, fontSize: 12, letterSpacing: 0.5, padding: '3px 10px', borderRadius: 999 } }, a.regionId),
            h('span', { style: { fontWeight: 800, fontSize: 16, color: c.title } }, `${c.icon} ${a.title}`),
          ),
          closeBtn(() => dismiss(a.id), 'Dismiss alert'),
        ),
        h('div', { style: { fontSize: 14.5, marginTop: 8, lineHeight: 1.5, fontWeight: 500 } }, a.message),
        a.emailNote && h('div', { style: { fontSize: 13, marginTop: 8, color: '#374151', fontWeight: 700 } }, a.emailNote),
        h('div', { style: { fontSize: 12, marginTop: 8, color: '#6b7280' } }, new Date(a.at).toLocaleString()),
      );
    }),
  );
}

function ensureMounted(): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById(ROOT_ID)) return;
  injectStyle();
  const el = document.createElement('div');
  el.id = ROOT_ID;
  document.body.appendChild(el);
  createRoot(el).render(h(AlertCenter));
}

/**
 * Automatic detection: watches the dashboard's own requests to /api/regions/<ID>/result (push mode) and
 * /api/regions/<ID>/ping (direct mode). When a finished result contains timed-out ping requests, an alert is
 * published. This works with any dashboard component, so no change to the dashboard code is needed.
 */
const handledResults = new Set<string>();

function inspectPingResponse(url: string, status: number, body: any): void {
  const m = /\/api\/regions\/([A-Z0-9-]+)\/(result|ping)(?:[?#]|$)/.exec(url);
  if (!m) return;
  const regionId = m[1];
  const data = m[2] === 'result' ? (body && body.status === 'done' ? body.result : null) : status === 200 ? body : null;
  if (!data || !Array.isArray(data.packets) || data.packets.length === 0) return;

  const key = `${regionId}:${data.timestamp ?? ''}:${data.requestsSent ?? ''}`;
  if (handledResults.has(key)) return;
  handledResults.add(key);
  if (handledResults.size > 200) handledResults.clear();

  const packets: Array<{ sequence: number; success: boolean }> = data.packets;
  let timeouts = packets.filter((p) => p && p.success === false).length;
  if (timeouts === 0 && typeof data.failedRequests === 'number') timeouts = data.failedRequests;
  if (timeouts <= 0) return;

  let run = 0;
  let maxRun = 0;
  for (const p of [...packets].sort((a, b) => a.sequence - b.sequence)) {
    if (p && p.success === false) { run += 1; if (run > maxRun) maxRun = run; } else { run = 0; }
  }
  const alert = data.alert || {};
  publishPingAlert({
    regionId,
    timeouts,
    total: typeof data.requestsSent === 'number' ? data.requestsSent : packets.length,
    maxConsecutive: maxRun,
    packetLossPercent: typeof data.packetLossPercent === 'number' ? data.packetLossPercent : undefined,
    level: alert.level === 'warning' || alert.level === 'critical' ? alert.level : undefined,
    threshold: typeof alert.threshold === 'number' ? alert.threshold : undefined,
    emailStatus: alert.emailStatus,
  });
}

function installFetchWatcher(): void {
  const w = window as any;
  if (typeof w.fetch !== 'function' || w.__pingAlertWatcher) return;
  w.__pingAlertWatcher = true;
  const original = w.fetch.bind(w);
  w.fetch = async (input: any, init?: any) => {
    const response: Response = await original(input, init);
    try {
      const url = typeof input === 'string' ? input : input && input.href ? input.href : input && input.url ? input.url : '';
      if (url.indexOf('/api/regions/') !== -1) {
        response.clone().json().then((body) => inspectPingResponse(url, response.status, body)).catch(() => undefined);
      }
    } catch {
      /* watching must never break a request */
    }
    return response;
  };
}

// Mount once when the dashboard loads, so alerts saved from an earlier visit show up again.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installFetchWatcher();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureMounted);
  else ensureMounted();
}
