/**
 * Anomaly detection + period comparison (pure functions, no I/O).
 *
 * HOW A MEASUREMENT IS JUDGED
 *  1. Baseline  = the median of the same metric for the same region over the last ANOMALY_LOOKBACK_DAYS
 *                 (default 7). The median is used instead of the average because one bad test
 *                 must not distort what "normal" means.
 *  2. Spread    = MAD (median absolute deviation) scaled to behave like a standard deviation, with a
 *                 minimum so that a very stable line does not raise alarms for tiny changes.
 *  3. Score (z) = how many "spreads" the new value is away from the baseline, in the BAD direction
 *                 (latency up is bad, download speed down is bad).
 *  4. Flag when  z >= ANOMALY_Z_WARN (3.5)  AND the change is at least ANOMALY_MIN_CHANGE_PCT (30%).
 *     Critical when z >= ANOMALY_Z_CRIT (6) AND the change is at least twice that percentage.
 *  5. Fixed rules (need no history): packet loss >= LOSS_WARN_PCT (5) warning, >= LOSS_CRIT_PCT (20)
 *     critical, 100% loss = outage.
 *  Until a region has ANOMALY_MIN_BASELINE (8) earlier measurements, only the fixed rules apply
 *  ("learning" phase).
 */
import type { MetricKind, Sample, StoredAnomaly } from './metricsStore';

export interface MetricDef {
  label: string;
  unit: string;
  bad: 'high' | 'low'; // which direction is a problem
  floor: number;       // smallest difference that matters (same unit as the metric)
  decimals: number;
}

export const METRICS: Record<MetricKind, Record<string, MetricDef>> = {
  ping: {
    avgLatencyMs: { label: 'Average latency', unit: 'ms', bad: 'high', floor: 1, decimals: 1 },
    jitterMs: { label: 'Jitter', unit: 'ms', bad: 'high', floor: 0.5, decimals: 2 },
    packetLossPercent: { label: 'Packet loss', unit: '%', bad: 'high', floor: 1, decimals: 1 },
  },
  speed: {
    downloadMbps: { label: 'Download speed', unit: 'Mbps', bad: 'low', floor: 1, decimals: 1 },
    uploadMbps: { label: 'Upload speed', unit: 'Mbps', bad: 'low', floor: 1, decimals: 1 },
    pingMs: { label: 'Ping', unit: 'ms', bad: 'high', floor: 1, decimals: 1 },
    jitterMs: { label: 'Jitter', unit: 'ms', bad: 'high', floor: 0.5, decimals: 2 },
  },
};

export interface DetectorConfig {
  lookbackDays: number;
  minBaseline: number;
  zWarn: number;
  zCrit: number;
  minChangePct: number;
  lossWarnPct: number;
  lossCritPct: number;
}

const envNum = (name: string, def: number, min: number, max: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
};

export function detectorConfig(): DetectorConfig {
  return {
    lookbackDays: envNum('ANOMALY_LOOKBACK_DAYS', 7, 1, 90),
    minBaseline: Math.round(envNum('ANOMALY_MIN_BASELINE', 8, 3, 500)),
    zWarn: envNum('ANOMALY_Z_WARN', 3.5, 1, 50),
    zCrit: envNum('ANOMALY_Z_CRIT', 6, 2, 100),
    minChangePct: envNum('ANOMALY_MIN_CHANGE_PCT', 30, 1, 1000),
    lossWarnPct: envNum('LOSS_WARN_PCT', 5, 0.1, 100),
    lossCritPct: envNum('LOSS_CRIT_PCT', 20, 0.1, 100),
  };
}

/* ------------------------------ statistics ------------------------------ */

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const fmt = (v: number, def: MetricDef) => `${round(v, def.decimals)} ${def.unit}`;

/* ------------------------------ detection ------------------------------ */

export function detectAnomalies(sample: Sample, baseline: Sample[], cfg: DetectorConfig = detectorConfig()): StoredAnomaly[] {
  const defs = METRICS[sample.kind];
  const out: StoredAnomaly[] = [];

  for (const [metric, def] of Object.entries(defs)) {
    const value = sample.m[metric];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;

    const history = baseline
      .filter((b) => b.id !== sample.id && b.kind === sample.kind && b.region === sample.region && typeof b.m[metric] === 'number')
      .map((b) => b.m[metric]);

    let severity: 'warning' | 'critical' | null = null;
    let type: StoredAnomaly['type'] = def.bad === 'high' ? 'spike' : 'drop';
    let base: number | null = null;
    let devPct: number | null = null;

    // (a) statistical check against the region's own normal
    if (history.length >= cfg.minBaseline) {
      base = median(history);
      const mad = median(history.map((h) => Math.abs(h - base!)));
      const scale = Math.max(mad * 1.4826, Math.abs(base) * 0.05, def.floor);
      const diff = def.bad === 'high' ? value - base : base - value; // positive = worse
      const z = diff / scale;
      devPct = (diff / Math.max(Math.abs(base), def.floor)) * 100;
      if (z >= cfg.zWarn && devPct >= cfg.minChangePct) severity = 'warning';
      if (z >= cfg.zCrit && devPct >= cfg.minChangePct * 2) severity = 'critical';
      // Packet loss: "critical" is decided only by the fixed limits below (a jump from 0% to 6% is a warning, not an emergency)
      if (metric === 'packetLossPercent' && severity === 'critical') severity = 'warning';
    }

    // (b) fixed rules for packet loss (work even before a baseline exists)
    if (metric === 'packetLossPercent') {
      const statSeverity = severity;
      const fixed = value >= cfg.lossCritPct ? 'critical' : value >= cfg.lossWarnPct ? 'warning' : null;
      if (fixed && (!severity || (fixed === 'critical' && severity === 'warning'))) severity = fixed;
      if (value >= 100) type = 'outage';
      else if (fixed && !statSeverity) type = 'threshold';
    }

    if (!severity) continue;

    let message: string;
    if (type === 'outage') {
      message = `${sample.region}: every ping request timed out (100% packet loss) - the region looks unreachable.`;
    } else if (base !== null && Math.abs(base) < def.floor && type !== 'threshold') {
      message = `${sample.region}: ${def.label.toLowerCase()} is ${fmt(value, def)}; it is normally close to 0 ${def.unit}.`;
    } else if (base !== null && devPct !== null && type !== 'threshold') {
      const dir = def.bad === 'high' ? 'above' : 'below';
      message = `${sample.region}: ${def.label.toLowerCase()} is ${fmt(value, def)}, ${Math.round(Math.abs(devPct))}% ${dir} its ${cfg.lookbackDays}-day normal of ${fmt(base, def)}.`;
    } else {
      message = `${sample.region}: ${def.label.toLowerCase()} is ${fmt(value, def)}, over the ${severity === 'critical' ? cfg.lossCritPct : cfg.lossWarnPct}% ${severity} limit.`;
    }

    out.push({
      id: `an_${sample.kind}_${sample.region}_${metric}_${sample.t}`,
      t: sample.t,
      kind: sample.kind,
      region: sample.region,
      metric,
      label: def.label,
      severity,
      type,
      value: round(value, 3),
      baselineMedian: base === null ? null : round(base, 3),
      deviationPct: devPct === null ? null : round(devPct, 1),
      message,
    });
  }
  return out;
}

/* ------------------------------ comparison ------------------------------ */

export interface Stats { n: number; avg: number; min: number; max: number; p50: number; p95: number }

export function stats(values: number[]): Stats | null {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    p50: median(values),
    p95: percentile(values, 0.95),
  };
}

export interface CompareRow {
  region: string;
  metric: string;
  label: string;
  unit: string;
  current: Stats | null;
  previous: Stats | null;
  deltaPct: number | null;           // change of the average, current vs previous
  verdict: 'better' | 'worse' | 'stable' | 'no-data';
}

export function comparePeriods(
  samples: Sample[],
  kind: MetricKind,
  regions: string[],
  current: { from: number; to: number },
  previous: { from: number; to: number },
  stableBandPct = 10
): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const region of regions) {
    for (const [metric, def] of Object.entries(METRICS[kind])) {
      const pick = (w: { from: number; to: number }) =>
        samples
          .filter((s) => s.region === region && s.t >= w.from && s.t <= w.to && typeof s.m[metric] === 'number')
          .map((s) => s.m[metric]);
      const c = stats(pick(current));
      const p = stats(pick(previous));
      let deltaPct: number | null = null;
      let verdict: CompareRow['verdict'] = 'no-data';
      if (c && p) {
        const diff = c.avg - p.avg;
        deltaPct = round((diff / Math.max(Math.abs(p.avg), def.floor)) * 100, 1);
        const worse = def.bad === 'high' ? diff > 0 : diff < 0;
        verdict = Math.abs(deltaPct) < stableBandPct || Math.abs(diff) < def.floor ? 'stable' : worse ? 'worse' : 'better';
      }
      rows.push({ region, metric, label: def.label, unit: def.unit, current: c, previous: p, deltaPct, verdict });
    }
  }
  return rows;
}

/* ------------------------------ trend buckets ------------------------------ */

export interface SeriesPoint { t: number; avg: number; min: number; max: number; n: number }

export function bucketSeries(samples: Sample[], metric: string, from: number, to: number, bucketMs: number): Record<string, SeriesPoint[]> {
  const byRegion: Record<string, Map<number, number[]>> = {};
  for (const s of samples) {
    const v = s.m[metric];
    if (typeof v !== 'number' || s.t < from || s.t > to) continue;
    const key = Math.floor(s.t / bucketMs) * bucketMs;
    const map = byRegion[s.region] || (byRegion[s.region] = new Map());
    const arr = map.get(key) || [];
    arr.push(v);
    map.set(key, arr);
  }
  const out: Record<string, SeriesPoint[]> = {};
  for (const [region, map] of Object.entries(byRegion)) {
    out[region] = [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, arr]) => {
        const st = stats(arr)!;
        return { t, avg: round(st.avg, 3), min: round(st.min, 3), max: round(st.max, 3), n: st.n };
      });
  }
  return out;
}
