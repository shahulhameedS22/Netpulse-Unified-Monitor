/**
 * Network Monitoring: long-term history, period comparison and anomaly alerts.
 * Data comes from the server-side history store (see src/server/monitoring.ts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Database, Download,
  Info, Loader2, Mail, RefreshCw, Timer, TrendingUp,
} from 'lucide-react';
import {
  acknowledgeAnomaly, csvUrl, fetchAnomalies, fetchCompare, fetchConfig, fetchHistory,
  type Anomaly, type CompareResponse, type HistoryResponse, type MetricKind, type MonitorConfig, type RangeKey,
} from '../services/monitoringApi';

const REGION_COLORS: Record<string, string> = {
  'IN-DC01': '#22d3ee', 'IN-DC02': '#818cf8', 'LK-DC01': '#fbbf24', 'SG-DC01': '#34d399',
};
const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: '6h', label: '6 hours' }, { key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' },
];

const fmtNum = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
};
const fmtWhen = (t: number) =>
  new Date(t).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ----------------------------- trend chart ----------------------------- */

const TrendChart: React.FC<{ data: HistoryResponse }> = ({ data }) => {
  const W = 900, H = 290, L = 56, R = 16, T = 16, B = 34;
  const regions = Object.keys(data.series);
  const all = regions.flatMap((r) => data.series[r]);
  if (all.length === 0) return null;

  const spanMs = data.to - data.from;
  const maxVal = Math.max(...all.map((p) => p.avg), ...data.anomalies.map((a) => a.value), 1) * 1.12;
  const x = (t: number) => L + ((t - data.from) / spanMs) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxVal) * (H - T - B);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxVal);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => data.from + f * spanMs);
  const xLabel = (t: number) =>
    spanMs <= 36 * 3_600_000
      ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${data.def.label} over time`}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#334155" strokeWidth={1} strokeDasharray={i === 0 ? '0' : '3 4'} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#94a3b8">{fmtNum(v)}</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 10} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize={11} fill="#94a3b8">
          {xLabel(t)}
        </text>
      ))}
      <text x={12} y={T + 4} fontSize={11} fill="#94a3b8">{data.def.unit}</text>

      {regions.map((r) => {
        const pts = data.series[r];
        const color = REGION_COLORS[r] || '#e2e8f0';
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t + data.bucketMs / 2).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
        return (
          <g key={r}>
            {pts.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
            {pts.map((p) => (
              <circle key={p.t} cx={x(p.t + data.bucketMs / 2)} cy={y(p.avg)} r={pts.length > 40 ? 1.8 : 3} fill={color}>
                <title>{`${r} - ${fmtWhen(p.t)}: ${fmtNum(p.avg)} ${data.def.unit} (${p.n} test${p.n === 1 ? '' : 's'})`}</title>
              </circle>
            ))}
          </g>
        );
      })}

      {data.anomalies.map((a) => (
        <g key={a.id}>
          <circle cx={x(a.t)} cy={y(a.value)} r={7} fill="none" stroke={a.severity === 'critical' ? '#ef4444' : '#f59e0b'} strokeWidth={2.5} />
          <title>{`${a.severity.toUpperCase()}: ${a.message}`}</title>
        </g>
      ))}
    </svg>
  );
};

/* ----------------------------- small pieces ----------------------------- */

const Card: React.FC<{ title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({ title, icon, right, children }) => (
  <section className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-5 sm:p-6 shadow-xl">
    <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <h2 className="flex items-center gap-2 text-base font-black text-white tracking-tight">{icon}{title}</h2>
      {right}
    </div>
    {children}
  </section>
);

const Pill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
      active ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40' : 'text-slate-300 border-slate-700 hover:bg-slate-800/80'
    }`}
  >
    {children}
  </button>
);

const VERDICT_STYLE: Record<string, string> = {
  better: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  worse: 'bg-red-500/15 text-red-300 border-red-500/40',
  stable: 'bg-slate-700/40 text-slate-300 border-slate-600',
  'no-data': 'bg-slate-800 text-slate-500 border-slate-700',
};

/* ----------------------------- page ----------------------------- */

export const MonitoringPage: React.FC = () => {
  const [config, setConfig] = useState<MonitorConfig | null>(null);
  const [kind, setKind] = useState<MetricKind>('ping');
  const [metric, setMetric] = useState('avgLatencyMs');
  const [range, setRange] = useState<RangeKey>('24h');
  const [region, setRegion] = useState('all');
  const [mode, setMode] = useState<'previous' | 'lastweek'>('previous');
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [showAcked, setShowAcked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetchConfig().then(setConfig).catch(() => undefined);
  }, [tick]);

  const metricOptions = useMemo(() => Object.entries(config?.metrics[kind] || {}), [config, kind]);

  const switchKind = (k: MetricKind) => {
    setKind(k);
    setMetric(k === 'ping' ? 'avgLatencyMs' : 'downloadMbps');
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchHistory(kind, metric, range, region), fetchCompare(kind, range, mode, region), fetchAnomalies(range)])
      .then(([h, c, a]) => {
        if (cancelled) return;
        setHistory(h); setCompare(c); setAnomalies(a.items); setError(null);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, metric, range, region, mode, tick]);

  // refresh every minute while the tab is open
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const ack = useCallback(async (id: string) => {
    setAnomalies((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
    try { await acknowledgeAnomaly(id); } catch { setTick((n) => n + 1); }
  }, []);

  const open = anomalies.filter((a) => !a.acknowledged);
  const shown = showAcked ? anomalies : open;
  const hasData = (history?.sampleCount || 0) > 0;
  const compareRows = (compare?.rows || []).filter((r) => r.current || r.previous);
  const regions = config?.regions || ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#141e33] via-[#16233f] to-[#122b44] border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
              <TrendingUp className="w-3.5 h-3.5" /> Network Monitoring
            </span>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">History, Comparison &amp; Anomaly Alerts</h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Every speed and ping result is kept as history. Each new result is compared with what that region normally
              looks like, and unusual values raise an alert.
            </p>
          </div>
          <div className="flex flex-wrap lg:flex-col gap-2 text-xs font-mono">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config?.storage.persistent ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-amber-500/40 text-amber-300 bg-amber-500/10'}`}>
              <Database className="w-3.5 h-3.5" />
              {config ? `History: ${config.storage.backend === 'redis' ? 'Redis' : 'local file'} - keeps ${config.storage.retentionDays} days${config.storage.persistent ? '' : ' (temporary)'}` : 'History: checking...'}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config?.scheduler.intervalMin || config?.scheduler.lastRunAt ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-300 bg-slate-800/60'}`}>
              <Timer className="w-3.5 h-3.5" />
              {config?.scheduler.intervalMin ? `Auto ping every ${config.scheduler.intervalMin} min` : config?.scheduler.lastRunAt ? `Last auto run ${fmtWhen(config.scheduler.lastRunAt)}` : 'Auto monitoring: off'}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config?.email.configured ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-300 bg-slate-800/60'}`}>
              <Mail className="w-3.5 h-3.5" />
              {config?.email.configured ? `E-mail on ${config.email.minSeverity}` : 'E-mail alerts: not configured'}
            </span>
          </div>
        </div>
        {config?.storage.note && (
          <div className="mt-4 flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {config.storage.note}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Test</span>
          <Pill active={kind === 'ping'} onClick={() => switchKind('ping')}>Ping</Pill>
          <Pill active={kind === 'speed'} onClick={() => switchKind('speed')}>Speed</Pill>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Period</span>
          {RANGES.map((r) => <Pill key={r.key} active={range === r.key} onClick={() => setRange(r.key)}>{r.label}</Pill>)}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Metric</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
            {metricOptions.map(([key, def]) => <option key={key} value={key}>{def.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="all">All regions</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setTick((n) => n + 1)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-200 hover:bg-slate-800/80 cursor-pointer">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <a href={csvUrl(kind, range)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-200 hover:bg-slate-800/80">
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-200 bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Anomalies */}
      <Card
        title={`Anomalies${open.length ? ` (${open.length} open)` : ''}`}
        icon={<AlertTriangle className={`w-4 h-4 ${open.length ? 'text-amber-400' : 'text-slate-400'}`} />}
        right={
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} /> Show acknowledged
          </label>
        }
      >
        {shown.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="w-4 h-4" /> No {showAcked ? '' : 'open '}anomalies in this period.
          </div>
        ) : (
          <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {shown.map((a) => (
              <li key={a.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${a.severity === 'critical' ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10'} ${a.acknowledged ? 'opacity-55' : ''}`}>
                <span className={`mt-0.5 text-[10px] font-black px-2 py-0.5 rounded-full text-white ${a.severity === 'critical' ? 'bg-red-600' : 'bg-amber-600'}`}>{a.severity.toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium leading-snug">{a.message}</div>
                  <div className="text-[11px] text-slate-400 mt-1 font-mono">
                    {fmtWhen(a.t)} - {a.kind} - {a.label}{a.emailStatus === 'sent' ? ' - e-mail sent' : ''}
                  </div>
                </div>
                {!a.acknowledged && (
                  <button type="button" onClick={() => ack(a.id)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700/60 cursor-pointer whitespace-nowrap">
                    Acknowledge
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Trend */}
      <Card
        title={history ? `${history.def.label} over time` : 'Trend'}
        icon={<Activity className="w-4 h-4 text-cyan-400" />}
        right={history && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            {Object.keys(history.series).map((r) => (
              <span key={r} className="inline-flex items-center gap-1.5 font-mono">
                <span className="w-3 h-1.5 rounded" style={{ background: REGION_COLORS[r] || '#e2e8f0' }} />{r}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 border-red-500" />anomaly</span>
          </div>
        )}
      >
        {loading && !history ? (
          <div className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="w-4 h-4 animate-spin" /> Loading history...</div>
        ) : history && hasData ? (
          <TrendChart data={history} />
        ) : (
          <div className="flex items-start gap-2 text-sm text-slate-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-cyan-400" />
            <span>
              No {kind} history in this period yet. Run a {kind === 'ping' ? 'Ping Monitoring' : 'Speed Test'} session
              {kind === 'ping' ? ', or turn on automatic monitoring (MONITOR_INTERVAL_MIN)' : ''} and the results appear here.
            </span>
          </div>
        )}
        {history && hasData && (
          <div className="mt-2 text-[11px] text-slate-500 font-mono">{history.sampleCount} measurements - each point is the average of a {Math.round(history.bucketMs / 60000)}-minute window</div>
        )}
      </Card>

      {/* Comparison */}
      <Card
        title="Comparison"
        icon={<ArrowUpRight className="w-4 h-4 text-cyan-400" />}
        right={
          <div className="flex items-center gap-2">
            <Pill active={mode === 'previous'} onClick={() => setMode('previous')}>vs previous period</Pill>
            <Pill active={mode === 'lastweek'} onClick={() => setMode('lastweek')}>vs same time last week</Pill>
          </div>
        }
      >
        {compare && (
          <p className="text-[11px] text-slate-400 font-mono mb-3">
            Now: {fmtWhen(compare.current.from)} - {fmtWhen(compare.current.to)} &nbsp;|&nbsp; Compared with: {fmtWhen(compare.previous.from)} - {fmtWhen(compare.previous.to)}
          </p>
        )}
        {compareRows.length === 0 ? (
          <div className="text-sm text-slate-300">Not enough history to compare yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="py-2 pr-3">Region</th><th className="pr-3">Metric</th>
                  <th className="pr-3 text-right">Before</th><th className="pr-3 text-right">Now</th>
                  <th className="pr-3 text-right">Worst 5% (p95)</th><th className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((r) => (
                  <tr key={`${r.region}-${r.metric}`} className="border-b border-slate-800 text-slate-200">
                    <td className="py-2 pr-3 font-mono font-bold" style={{ color: REGION_COLORS[r.region] }}>{r.region}</td>
                    <td className="pr-3">{r.label}</td>
                    <td className="pr-3 text-right font-mono">{r.previous ? `${fmtNum(r.previous.avg)} ${r.unit}` : '-'}</td>
                    <td className="pr-3 text-right font-mono">{r.current ? `${fmtNum(r.current.avg)} ${r.unit}` : '-'}</td>
                    <td className="pr-3 text-right font-mono">{r.current ? `${fmtNum(r.current.p95)} ${r.unit}` : '-'}</td>
                    <td className="text-right">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-mono font-bold ${VERDICT_STYLE[r.verdict]}`}>
                        {r.verdict === 'worse' && <ArrowUpRight className="w-3 h-3" />}
                        {r.verdict === 'better' && <ArrowDownRight className="w-3 h-3" />}
                        {r.deltaPct === null ? 'no data' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}% ${r.verdict}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* How it works */}
      {config && (
        <Card title="How anomalies are detected" icon={<Info className="w-4 h-4 text-cyan-400" />}>
          <ul className="text-xs sm:text-sm text-slate-300 leading-relaxed space-y-1.5 list-disc pl-5">
            <li>
              For every region and metric the system learns what is <b>normal</b>: the median of the last {config.detector.lookbackDays} days
              (needs at least {config.detector.minBaseline} earlier results; until then the region is still &quot;learning&quot;).
            </li>
            <li>
              A new result is flagged when it is far outside that normal range in the bad direction (higher latency, jitter or
              loss; lower speed) <b>and</b> at least {config.detector.minChangePct}% different. It is <b>critical</b> when it is extremely far
              out (at least {config.detector.minChangePct * 2}% different).
            </li>
            <li>
              Packet loss also has fixed limits: warning from {config.detector.lossWarnPct}%, critical from {config.detector.lossCritPct}%, and 100% is reported as an outage.
            </li>
            <li>Critical anomalies are e-mailed (at most one e-mail per region and metric every {config.email.cooldownMin} minutes). Every anomaly also appears here and as a pop-up after a test.</li>
          </ul>
        </Card>
      )}
    </div>
  );
};
