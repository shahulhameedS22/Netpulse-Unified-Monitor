/**
 * CSV downloads for the Speed Test and Ping Monitor pages.
 * Same layout as the history export: separate Date and Time columns (in the viewer's time zone)
 * and headers with the unit in brackets, e.g. "Download (Mbps)".
 */
import type { RegionPingResult } from '../types/ping';

export const browserTimeZone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

const zoneName = (tz: string): string => {
  if (tz === 'UTC') return 'UTC';
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch { return tz; }
};

const cell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (n: number | null | undefined): string | number => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : '');

/** Splits a timestamp into "2026-11-13" and "10:22:44" in the viewer's time zone. */
function dateTime(at: string | number | Date | null | undefined, tz: string): { date: string; time: string } {
  const d = at === null || at === undefined || at === '' ? null : new Date(at);
  if (!d || Number.isNaN(d.getTime())) return { date: '', time: '' };
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export function saveCsv(fileBase: string, lines: string[]): void {
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBase}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File name part such as "2026-11-13_10-22" in the viewer's time zone. */
export function stamp(at: string | number | Date | null | undefined): string {
  const { date, time } = dateTime(at ?? new Date(), browserTimeZone());
  return `${date || 'run'}_${time.slice(0, 5).replace(':', '-')}`;
}

/* ------------------------------- speed ------------------------------- */

export interface SpeedCsvRow {
  at?: string | null;
  serverCode: string;
  name: string;
  status: string;
  downloadMbps: number | null;
  uploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  note?: string | null;
}

export function speedCsv(rows: SpeedCsvRow[], fallbackAt?: string | null): string[] {
  const tz = browserTimeZone();
  const lines = [['Date', `Time (${zoneName(tz)})`, 'Region', 'Location', 'Status', 'Download (Mbps)', 'Upload (Mbps)', 'Ping (ms)', 'Jitter (ms)', 'Note'].map(cell).join(',')];
  for (const r of rows) {
    const t = dateTime(r.at || fallbackAt, tz);
    lines.push([t.date, t.time, r.serverCode, r.name, r.status, num(r.downloadMbps), num(r.uploadMbps), num(r.pingMs), num(r.jitterMs), r.note || ''].map(cell).join(','));
  }
  return lines;
}

/* -------------------------------- ping -------------------------------- */

const PING_ORDER = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];
const pingRows = (results: Record<string, RegionPingResult>): RegionPingResult[] =>
  PING_ORDER.map((id) => results[id]).filter((r): r is RegionPingResult => !!r && r.status !== 'Not Tested');

/** One row per region: packets, loss, min / avg / max latency, jitter. */
export function pingCsv(results: Record<string, RegionPingResult>): string[] {
  const tz = browserTimeZone();
  const lines = [['Date', `Time (${zoneName(tz)})`, 'Region', 'Location', 'Target', 'Status', 'Packets Sent', 'Replies', 'Lost', 'Packet Loss (%)', 'Min Latency (ms)', 'Avg Latency (ms)', 'Max Latency (ms)', 'Jitter (ms)', 'Duration (ms)', 'Note'].map(cell).join(',')];
  for (const r of pingRows(results)) {
    const t = dateTime(r.completedAt || r.startedAt, tz);
    lines.push([t.date, t.time, r.regionId, r.regionName, r.targetIp, r.status, r.requestsSent, r.successfulReplies, r.failedRequests, num(r.packetLossPercent), num(r.minLatencyMs), num(r.avgLatencyMs), num(r.maxLatencyMs), num(r.jitterMs), num(r.durationMs), r.errorDetails || ''].map(cell).join(','));
  }
  return lines;
}

/** One row per packet: which ones got a reply and which timed out. */
export function pingPacketsCsv(results: Record<string, RegionPingResult>): string[] {
  const tz = browserTimeZone();
  const lines = [['Date', `Time (${zoneName(tz)})`, 'Region', 'Packet No.', 'Result', 'Latency (ms)', 'TTL'].map(cell).join(',')];
  for (const r of pingRows(results)) {
    for (const p of r.packets || []) {
      const t = dateTime(p.timestamp || r.startedAt, tz);
      lines.push([t.date, t.time, r.regionId, p.sequence, p.success ? 'Reply' : 'Timeout', num(p.latencyMs), p.ttl ?? ''].map(cell).join(','));
    }
  }
  return lines;
}
