/**
 * Client for the history / comparison / anomaly API (see src/server/monitoring.ts).
 */
import { publishAnomalyAlert } from './alertCenter';

export type MetricKind = 'ping' | 'speed';
export type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';

export interface MetricDef { label: string; unit: string; bad: 'high' | 'low'; decimals: number }
export interface SeriesPoint { t: number; avg: number; min: number; max: number; n: number }
export interface Anomaly {
  id: string; t: number; kind: MetricKind; region: string; metric: string; label: string;
  severity: 'warning' | 'critical'; type: 'spike' | 'drop' | 'threshold' | 'outage';
  value: number; baselineMedian: number | null; deviationPct: number | null; message: string;
  emailStatus?: string; acknowledged?: boolean;
}
export interface Stats { n: number; avg: number; min: number; max: number; p50: number; p95: number }
export interface CompareRow {
  region: string; metric: string; label: string; unit: string;
  current: Stats | null; previous: Stats | null; deltaPct: number | null;
  verdict: 'better' | 'worse' | 'stable' | 'no-data';
}
export interface HistoryResponse {
  kind: MetricKind; metric: string; def: MetricDef; from: number; to: number; bucketMs: number;
  sampleCount: number; series: Record<string, SeriesPoint[]>; anomalies: Anomaly[];
}
export interface CompareResponse {
  kind: MetricKind; mode: 'previous' | 'lastweek';
  current: { from: number; to: number }; previous: { from: number; to: number }; rows: CompareRow[];
}
export interface MonitorConfig {
  storage: { backend: 'redis' | 'file'; persistent: boolean; retentionDays: number; note?: string };
  detector: { lookbackDays: number; minBaseline: number; zWarn: number; zCrit: number; minChangePct: number; lossWarnPct: number; lossCritPct: number };
  metrics: Record<MetricKind, Record<string, MetricDef>>;
  regions: string[];
  email: { configured: boolean; minSeverity: 'warning' | 'critical'; cooldownMin: number };
  scheduler: { intervalMin: number | null; lastRunAt: number | null; lastResult: Array<{ region: string; status: string; detail?: string }> | null };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
  return body as T;
}

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const fetchConfig = () => getJson<MonitorConfig>('/api/monitor/config');
export const fetchHistory = (kind: MetricKind, metric: string, range: RangeKey, region: string) =>
  getJson<HistoryResponse>(`/api/metrics/history?${qs({ kind, metric, range, region })}`);
export const fetchCompare = (kind: MetricKind, range: RangeKey, mode: 'previous' | 'lastweek', region: string) =>
  getJson<CompareResponse>(`/api/metrics/compare?${qs({ kind, range, mode, region })}`);
export const fetchAnomalies = (range: RangeKey) =>
  getJson<{ openCount: number; items: Anomaly[] }>(`/api/metrics/anomalies?${qs({ range })}`);
export const csvUrl = (kind: MetricKind, range: RangeKey) => `/api/metrics/export.csv?${qs({ kind, range })}`;

export async function acknowledgeAnomaly(id: string): Promise<void> {
  const res = await fetch(`/api/metrics/anomalies/${encodeURIComponent(id)}/ack`, { method: 'POST' });
  if (!res.ok) throw new Error(`Could not acknowledge (HTTP ${res.status})`);
}

/**
 * Called after a ping / speed session finishes. The server stores the measurements in the long-term
 * history and checks them for anomalies; anything it finds is shown immediately in the alert panel.
 * Failures are ignored on purpose: monitoring must never break a test.
 */
export async function reportSessionToMonitoring(kind: MetricKind, session: unknown): Promise<void> {
  try {
    const res = await fetch('/api/metrics/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // per-packet details are not needed for history, so they are left out to keep the request small
      body: JSON.stringify({ kind, session }, (key, value) => (key === 'packets' ? undefined : value)),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;
    const body = await res.json();
    for (const a of (body?.anomalies || []) as Anomaly[]) {
      publishAnomalyAlert({ regionId: a.region, level: a.severity, title: `${a.label} anomaly`, message: a.message, emailStatus: a.emailStatus });
    }
  } catch (err) {
    console.warn('[monitoring] could not report session:', err);
  }
}
