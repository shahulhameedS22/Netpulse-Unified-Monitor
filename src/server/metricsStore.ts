/**
 * Durable Firestore time-series store for manually completed team tests.
 * No Redis or ephemeral filesystem fallback is used for analytics history.
 */
import { firestoreRange, firestoreSet, isFirestoreConfigured } from './firestoreRest.js';

export type MetricKind = 'ping' | 'speed';

export interface Sample {
  id: string;
  t: number;
  kind: MetricKind;
  region: string;
  source: 'manual';
  m: Record<string, number>;
}

export interface StoredAnomaly {
  id: string;
  t: number;
  kind: MetricKind;
  region: string;
  metric: string;
  label: string;
  severity: 'warning' | 'critical';
  type: 'spike' | 'drop' | 'threshold' | 'outage';
  value: number;
  baselineMedian: number | null;
  deviationPct: number | null;
  message: string;
  emailStatus?: string;
}

export const retentionDays = (): number => {
  const n = Number(process.env.HISTORY_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 1 && n <= 3650 ? Math.floor(n) : 90;
};

interface Backend {
  name: 'firestore';
  persistent: true;
  range(col: string, from: number, to: number, limit: number): Promise<any[]>;
  add(col: string, t: number, item: any, id: string): Promise<void>;
  prune(col: string, before: number): Promise<void>;
}

const firestoreBackend: Backend = {
  name: 'firestore',
  persistent: true,
  range: firestoreRange,
  async add(col, t, item, id) {
    const expiresAt = new Date(t + retentionDays() * 86_400_000);
    await firestoreSet(col, id, { ...item, expiresAt });
  },
  // Firestore TTL removes documents asynchronously after expiresAt. No expensive scan/delete loop.
  async prune() {},
};

export function backend(): Backend {
  if (!isFirestoreConfigured()) throw new Error('FIRESTORE_SERVICE_ACCOUNT_NOT_CONFIGURED');
  return firestoreBackend;
}

export function storageInfo() {
  const configured = isFirestoreConfigured();
  return {
    backend: configured ? 'firestore' as const : 'unavailable' as const,
    persistent: configured,
    retentionDays: retentionDays(),
    note: configured
      ? 'Historical analytics are stored in Firestore. Enable TTL on the expiresAt field for automatic retention cleanup.'
      : 'Historical analytics storage is not configured. Add FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_PROJECT_ID on the server before enabling analytics.',
  };
}

export const REGIONS = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as const;
const sampleCol = (kind: MetricKind, region: string) => `netpulse_samples_${kind}_${region}`;

export async function addSample(s: Sample): Promise<void> {
  await backend().add(sampleCol(s.kind, s.region), s.t, s, s.id);
}

export async function getSamples(
  kind: MetricKind,
  region: string | 'all',
  from: number,
  to: number,
  limitPerRegion = 5000
): Promise<Sample[]> {
  const regions = region === 'all' ? [...REGIONS] : [region];
  const b = backend();
  const parts = await Promise.all(regions.map((r) => b.range(sampleCol(kind, r), from, to, limitPerRegion)));
  return parts.flat().sort((a, c) => a.t - c.t);
}

export async function addAnomaly(a: StoredAnomaly): Promise<void> {
  await backend().add('netpulse_anomalies', a.t, a, a.id);
}
export async function getAnomalies(from: number, to: number, limit = 500): Promise<StoredAnomaly[]> {
  return backend().range('netpulse_anomalies', from, to, limit);
}
export async function ackAnomaly(id: string): Promise<void> {
  const t = Date.now();
  await backend().add('netpulse_anomaly_acks', t, { id, t, ackId: `${id}@${t}` }, `${id}@${t}`);
}
export async function getAckedIds(from: number): Promise<Set<string>> {
  const rows = await backend().range('netpulse_anomaly_acks', from, Date.now() + 1000, 5000);
  return new Set(rows.map((r: any) => r.id));
}

/** Firestore TTL handles retention; retained as a compatibility no-op for callers. */
export async function pruneOld(): Promise<void> {
  if (!isFirestoreConfigured()) throw new Error('FIRESTORE_SERVICE_ACCOUNT_NOT_CONFIGURED');
}
