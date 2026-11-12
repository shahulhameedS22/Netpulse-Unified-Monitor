/**
 * Long-term time-series store for network measurements ("historical data").
 *
 * What is stored (one small record per region per test, ~250 bytes):
 *   - samples   : measurements (ping latency/jitter/loss, speed down/up/ping/jitter)
 *   - anomalies : problems the detector found (see anomaly.ts)
 *   - acks      : "acknowledged" markers for anomalies
 *
 * Where it is stored:
 *   - Upstash Redis (UPSTASH_REDIS_REST_URL / _TOKEN)  -> survives restarts and serverless (Vercel). Recommended.
 *   - Local JSON file (./data/netpulse-history.json)    -> fine for a VM / container with a persistent disk.
 *     On Vercel without Redis the file lives in /tmp and is LOST between deployments/cold starts.
 *
 * Retention: records older than HISTORY_RETENTION_DAYS (default 90) are deleted automatically.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export type MetricKind = 'ping' | 'speed';

export interface Sample {
  id: string;                 // unique per (kind, region, session) so a re-sent session is not stored twice
  t: number;                  // epoch ms of the measurement
  kind: MetricKind;
  region: string;             // IN-DC01 | IN-DC02 | LK-DC01 | SG-DC01
  source: 'manual' | 'scheduled';
  m: Record<string, number>;  // metric name -> value (only metrics that were measured)
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

/* ------------------------------ backends ------------------------------ */

interface Backend {
  name: 'redis' | 'file';
  persistent: boolean;
  /** newest `limit` records of a collection with from <= t <= to, returned oldest -> newest */
  range(col: string, from: number, to: number, limit: number): Promise<any[]>;
  add(col: string, t: number, item: any, id: string): Promise<void>;
  prune(col: string, before: number): Promise<void>;
  /** timestamp of the oldest record in a collection, or null when it is empty */
  first(col: string): Promise<number | null>;
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redis(cmds: (string | number)[][]): Promise<any[]> {
  const cfg = redisConfig();
  if (!cfg) throw new Error('STORAGE_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
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

const redisBackend: Backend = {
  name: 'redis',
  persistent: true,
  async range(col, from, to, limit) {
    // newest first with LIMIT, then flipped to oldest -> newest
    const [rows] = await redis([['ZREVRANGEBYSCORE', `nm:${col}`, to, from, 'LIMIT', 0, limit]]);
    return (rows as string[]).map((s) => JSON.parse(s)).reverse();
  },
  async add(col, t, item) {
    await redis([['ZADD', `nm:${col}`, t, JSON.stringify(item)]]);
  },
  async prune(col, before) {
    await redis([['ZREMRANGEBYSCORE', `nm:${col}`, '-inf', before]]);
  },
  async first(col) {
    const [rows] = await redis([['ZRANGE', `nm:${col}`, 0, 0, 'WITHSCORES']]);
    return Array.isArray(rows) && rows.length >= 2 ? Number(rows[1]) : null;
  },
};

/** File backend: everything is kept in memory and written to one JSON file after each change. */
const FILE_CAP = 60_000; // max records per collection kept in the file (oldest dropped first)
let fileData: Record<string, any[]> | null = null;
let filePath: string | null = null;

function resolveFilePath(): string {
  if (filePath) return filePath;
  const dir = process.env.VERCEL ? path.join(os.tmpdir(), 'netpulse-data') : path.resolve(process.cwd(), 'data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* handled on write */ }
  const resolved = path.join(dir, 'netpulse-history.json');
  filePath = resolved;
  return resolved;
}
function loadFile(): Record<string, any[]> {
  if (fileData) return fileData;
  try {
    const raw = fs.readFileSync(resolveFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    fileData = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    fileData = {};
  }
  return fileData!;
}
let writeTimer: ReturnType<typeof setTimeout> | null = null;
function flushFile(): void {
  try {
    fs.writeFileSync(resolveFilePath(), JSON.stringify(fileData || {}), 'utf-8');
  } catch (err: any) {
    console.warn('[history] could not write history file:', err?.message || err);
  }
}
function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; flushFile(); }, 300);
}

const fileBackend: Backend = {
  name: 'file',
  persistent: !process.env.VERCEL,
  async range(col, from, to, limit) {
    const rows = (loadFile()[col] || []).filter((r) => r.t >= from && r.t <= to);
    return rows.slice(-limit);
  },
  async add(col, t, item, id) {
    const data = loadFile();
    const arr = data[col] || (data[col] = []);
    if (arr.some((r) => r.id === id)) return; // already stored
    arr.push(item);
    arr.sort((a, b) => a.t - b.t);
    if (arr.length > FILE_CAP) arr.splice(0, arr.length - FILE_CAP);
    scheduleWrite();
  },
  async prune(col, before) {
    const data = loadFile();
    if (data[col]) {
      data[col] = data[col].filter((r) => r.t >= before);
      scheduleWrite();
    }
  },
  async first(col) {
    const arr = loadFile()[col] || [];
    return arr.length ? arr[0].t : null;
  },
};

export function backend(): Backend {
  return redisConfig() ? redisBackend : fileBackend;
}

export function storageInfo() {
  const b = backend();
  return {
    backend: b.name,
    persistent: b.persistent,
    retentionDays: retentionDays(),
    note: b.name === 'file' && process.env.VERCEL
      ? 'Running on Vercel without Redis: history is temporary. Connect Upstash Redis for permanent history.'
      : undefined,
  };
}

/* ------------------------------ public API ------------------------------ */

export const REGIONS = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as const;
const sampleCol = (kind: MetricKind, region: string) => `samples:${kind}:${region}`;

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

/** When did history for this kind/region start? (null = nothing stored yet) */
export async function firstSampleTime(kind: MetricKind, region: string | 'all'): Promise<number | null> {
  const regions = region === 'all' ? [...REGIONS] : [region];
  const b = backend();
  const times = (await Promise.all(regions.map((r) => b.first(sampleCol(kind, r))))).filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

export async function addAnomaly(a: StoredAnomaly): Promise<void> {
  await backend().add('anomalies', a.t, a, a.id);
}
export async function getAnomalies(from: number, to: number, limit = 500): Promise<StoredAnomaly[]> {
  return backend().range('anomalies', from, to, limit);
}
export async function ackAnomaly(id: string): Promise<void> {
  const t = Date.now();
  await backend().add('acks', t, { id, t, ackId: `${id}@${t}` }, `${id}@${t}`);
}
export async function getAckedIds(from: number): Promise<Set<string>> {
  const rows = await backend().range('acks', from, Date.now() + 1000, 5000);
  return new Set(rows.map((r: any) => r.id));
}

/** Deletes everything older than the retention period. Called now and then from ingest. */
export async function pruneOld(): Promise<void> {
  const before = Date.now() - retentionDays() * 86_400_000;
  const b = backend();
  const cols = ['anomalies', 'acks'];
  for (const kind of ['ping', 'speed'] as MetricKind[]) for (const r of REGIONS) cols.push(sampleCol(kind, r));
  await Promise.all(cols.map((c) => b.prune(c, before)));
}

/** Test helper: forget in-memory file state (does not delete the file). */
export function _resetForTests(): void {
  fileData = null;
  filePath = null;
}
