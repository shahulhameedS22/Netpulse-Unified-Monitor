/**
 * Network Monitoring: long-term history, period comparison and anomaly alerts.
 * Data comes from the server-side history store (see src/server/monitoring.ts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarRange, CheckCircle2, Database,
  Download, GraduationCap, Info, Loader2, Mail, RefreshCw, ShieldCheck, Timer, TrendingUp,
} from 'lucide-react';
import {
  acknowledgeAnomaly, csvUrl, fetchAnomalies, fetchCompare, fetchConfig, fetchHistory, fetchStatus, sendTestEmail,
  type Anomaly, type CompareResponse, type DetectionRow, type HistoryResponse, type MetricKind, type MonitorConfig,
  type Period, type RangeKey,
} from '../services/monitoringApi';

const REGION_COLORS: Record<string, string> = {
  'IN-DC01': '#22d3ee', 'IN-DC02': '#818cf8', 'LK-DC01': '#fbbf24', 'SG-DC01': '#34d399',
};
const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: '6h', label: '6 hours' }, { key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' },
];
const DAY = 86_400_000;

/* ----------------------------- formatting ----------------------------- */

const fmtNum = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
};
const fmtWhen = (t: number) =>
  new Date(t).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtFull = (t: number) =>
  new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const describeSpan = (ms: number): string => {
  const h = ms / 3_600_000;
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} days`;
};

/* ----------------------------- trend chart ----------------------------- */

const TrendChart: React.FC<{ data: HistoryResponse }> = ({ data }) => {
  const W = 900, H = 300, L = 60, R = 16, T = 16, B = 34;
  const regions = Object.keys(data.series);
  const all = regions.flatMap((r) => data.series[r]);
  if (all.length === 0) return null;

  const spanMs = data.to - data.from;
  const lim = data.limits;
  const maxVal = Math.max(...all.map((p) => p.avg), ...data.anomalies.map((a) => a.value), lim ? lim.warning : 0, lim ? lim.normal : 0, 1) * 1.12;
  const x = (t: number) => L + ((t - data.from) / spanMs) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxVal) * (H - T - B);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxVal);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => data.from + f * spanMs);
  const xLabel = (t: number) =>
    spanMs <= 36 * 3_600_000
      ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

  const limitLine = (v: number, color: string, label: string) => (
    <g>
      <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={color} strokeWidth={1.4} strokeDasharray="6 4" />
      <text x={W - R - 4} y={y(v) - 5} textAnchor="end" fontSize={10.5} fill={color}>{label}</text>
    </g>
  );

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

      {lim && limitLine(lim.normal, '#94a3b8', `normal ${fmtNum(lim.normal)} ${data.def.unit}`)}
      {lim && limitLine(lim.warning, '#f59e0b', `alert starts ${fmtNum(lim.warning)} ${data.def.unit}`)}

      {regions.map((r) => {
        const pts = data.series[r];
        const color = REGION_COLORS[r] || '#e2e8f0';
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t + data.bucketMs / 2).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
        return (
          <g key={r}>
            {pts.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
            {pts.map((p) => (
              <circle key={p.t} cx={x(p.t + data.bucketMs / 2)} cy={y(p.avg)} r={pts.length > 40 ? 1.8 : 3.5} fill={color}>
                <title>{`${r} - ${fmtWhen(p.t)}: ${fmtNum(p.avg)} ${data.def.unit} (${p.n} test${p.n === 1 ? '' : 's'})`}</title>
              </circle>
            ))}
          </g>
        );
      })}

      {data.anomalies.map((a) => (
        <g key={a.id}>
          <circle cx={x(a.t)} cy={y(a.value)} r={8} fill="none" stroke={a.severity === 'critical' ? '#ef4444' : '#f59e0b'} strokeWidth={2.5} />
          <title>{`${a.severity.toUpperCase()}: ${a.message}`}</title>
        </g>
      ))}
    </svg>
  );
};

/* ----------------------------- small pieces ----------------------------- */

const Card: React.FC<{ title: string; icon?: React.ReactNode; right?: React.ReactNode; sub?: string; children: React.ReactNode }> = ({ title, icon, right, sub, children }) => (
  <section className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-5 sm:p-6 shadow-xl">
    <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div>
        <h2 className="flex items-center gap-2 text-base font-black text-white tracking-tight">{icon}{title}</h2>
        {sub && <p className="text-[11px] text-slate-400 mt-1 font-mono">{sub}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const Pill: React.FC<{ active: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }> = ({ active, onClick, disabled, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${
      active ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40' : 'text-slate-300 border-slate-700 hover:bg-slate-800/80'
    }`}
  >
    {children}
  </button>
);

const Notice: React.FC<{ tone: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }> = ({ tone, children }) => {
  const style = ({
    info: 'text-cyan-100 bg-cyan-500/10 border-cyan-500/30',
    warn: 'text-amber-100 bg-amber-500/10 border-amber-500/40',
    error: 'text-red-200 bg-red-500/10 border-red-500/40',
    ok: 'text-emerald-200 bg-emerald-500/10 border-emerald-500/30',
  } as Record<string, string>)[tone];
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 text-xs sm:text-sm rounded-xl border px-3.5 py-2.5 leading-relaxed ${style}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" /> <div>{children}</div>
    </div>
  );
};

const VERDICT_STYLE: Record<string, string> = {
  better: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  worse: 'bg-red-500/15 text-red-300 border-red-500/40',
  stable: 'bg-slate-700/40 text-slate-300 border-slate-600',
  'no-data': 'bg-slate-800 text-slate-500 border-slate-700',
};

/** Plain-language reason + what to check, for one anomaly. */
function explainAnomaly(a: Anomaly, cfg: MonitorConfig | null): { why: string; check: string } {
  const d = cfg?.detector;
  if (a.type === 'outage') {
    return { why: 'Every ping request in this test received no reply (100% packet loss).', check: 'The region may be offline or unreachable. Check the regional agent and the link, then run a manual test to confirm.' };
  }
  if (a.type === 'threshold') {
    const limit = a.severity === 'critical' ? d?.lossCritPct : d?.lossWarnPct;
    return { why: `Packet loss is above the fixed ${a.severity} limit of ${limit ?? '?'}%. This rule works even without history.`, check: 'Lost replies point to a congested or faulty link, or ICMP being rate-limited on the path. Run the test again to see if it repeats.' };
  }
  const usual = `This is ${a.type === 'drop' ? 'lower' : 'higher'} than this region usually shows${d ? `, by more than ${d.minChangePct}% and far outside its normal ups and downs` : ''}.`;
  const checks: Record<string, string> = {
    avgLatencyMs: 'Look for a route change or congestion. If other regions look normal, the problem is specific to this region.',
    jitterMs: 'Unstable timing usually means congestion or a poor link. Check if it keeps happening.',
    packetLossPercent: 'Replies are being lost on the way. Check the link or ISP, and repeat the test.',
    downloadMbps: 'Check bandwidth usage on the link and any ISP throttling. Run the test again to confirm.',
    uploadMbps: 'Check bandwidth usage on the link and any ISP throttling. Run the test again to confirm.',
    pingMs: 'Look for a route change or congestion on the way to this region.',
  };
  return { why: usual, check: checks[a.metric] || 'Run the test again to confirm.' };
}

/* ----------------------------- page ----------------------------- */

export const MonitoringPage: React.FC = () => {
  const [config, setConfig] = useState<MonitorConfig | null>(null);
  const [kind, setKind] = useState<MetricKind>('ping');
  const [metric, setMetric] = useState('avgLatencyMs');
  const [region, setRegion] = useState('all');
  const [mode, setMode] = useState<'previous' | 'lastweek'>('previous');

  // period: a preset, or an exact custom from/to
  const [period, setPeriod] = useState<Period>({ type: 'preset', range: '24h' });
  const [customOpen, setCustomOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(() => toInput(Date.now() - DAY));
  const [draftTo, setDraftTo] = useState(() => toInput(Date.now()));
  const [customError, setCustomError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [statusRows, setStatusRows] = useState<DetectionRow[]>([]);
  const [showAcked, setShowAcked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; text: string } | null>(null);

  const runEmailTest = async () => {
    setTestingEmail(true);
    setEmailResult(null);
    try {
      const sentTo = await sendTestEmail();
      setEmailResult({ ok: true, text: `Test e-mail sent to ${sentTo.join(', ')}. Check the inbox (and the spam folder).` });
    } catch (e) {
      setEmailResult({ ok: false, text: (e as Error).message });
    } finally {
      setTestingEmail(false);
    }
  };

  useEffect(() => {
    fetchConfig().then(setConfig).catch(() => undefined);
  }, [tick]);

  const metricOptions = useMemo(() => Object.entries(config?.metrics[kind] || {}), [config, kind]);

  const switchKind = (k: MetricKind) => {
    setKind(k);
    setMetric(k === 'ping' ? 'avgLatencyMs' : 'downloadMbps');
  };

  const PRESET_MS: Record<RangeKey, number> = { '1h': 3_600_000, '6h': 6 * 3_600_000, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };
  const spanMs = period.type === 'custom' ? period.to - period.from : PRESET_MS[period.range];
  const lastWeekPossible = spanMs <= 7 * DAY;
  const effectiveMode = mode === 'lastweek' && !lastWeekPossible ? 'previous' : mode;

  const choosePreset = (range: RangeKey) => {
    setCustomOpen(false);
    setCustomError(null);
    setPeriod({ type: 'preset', range });
  };

  const applyCustom = () => {
    const from = Date.parse(draftFrom);
    let to = Date.parse(draftTo);
    if (!Number.isFinite(from) || !Number.isFinite(to)) { setCustomError('Please choose both a start and an end date.'); return; }
    if (to > Date.now()) to = Date.now(); // the future has no data
    if (from >= to) { setCustomError('The start must be earlier than the end.'); return; }
    if (to - from < 10 * 60_000) { setCustomError('Please choose a period of at least 10 minutes.'); return; }
    if (to - from > 400 * DAY) { setCustomError('The period can be at most 400 days.'); return; }
    setCustomError(null);
    setPeriod({ type: 'custom', from, to });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchHistory(kind, metric, period, region),
      fetchCompare(kind, period, effectiveMode, region),
      fetchAnomalies(period),
      fetchStatus(kind, region),
    ])
      .then(([h, c, a, s]) => {
        if (cancelled) return;
        setHistory(h); setCompare(c); setAnomalies(a.items); setStatusRows(s.rows); setError(null);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, metric, period, region, effectiveMode, tick]);

  // refresh every minute while the tab is open (only presets move with time)
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
  const regions = config?.regions || ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];
  const metricStatus = statusRows.filter((r) => r.metric === metric);
  const activeCount = metricStatus.filter((r) => r.state === 'active').length;
  const metricUnit = config?.metrics[kind]?.[metric]?.unit || '';
  const periodLabel = history ? `${fmtFull(history.from)}  to  ${fmtFull(history.to)}` : '';

  const compareRows = (compare?.rows || []).filter((r) => r.current || r.previous);
  const worse = compareRows.filter((r) => r.verdict === 'worse').length;
  const better = compareRows.filter((r) => r.verdict === 'better').length;
  const stable = compareRows.filter((r) => r.verdict === 'stable').length;

  const compareProblem = (() => {
    if (!compare) return null;
    if (!compare.currentHasData && !compare.previousHasData) {
      return { tone: 'warn' as const, text: `There are no ${kind} results stored for either period. ${compare.firstSampleAt ? `History for this test starts on ${fmtFull(compare.firstSampleAt)}.` : 'Run a test to start building history.'}` };
    }
    if (!compare.currentHasData) {
      return { tone: 'warn' as const, text: 'There are no results in the current period, so nothing can be compared. Choose a period in which tests were run.' };
    }
    if (!compare.previousHasData) {
      const startsAfter = compare.firstSampleAt !== null && compare.firstSampleAt > compare.previous.to;
      return {
        tone: 'warn' as const,
        text: startsAfter
          ? `No data is available for the comparison period (${fmtFull(compare.previous.from)} to ${fmtFull(compare.previous.to)}). Stored history for this test only starts on ${fmtFull(compare.firstSampleAt as number)}, so there is nothing to compare with yet. Try "vs previous period" with a shorter period, or compare again after more history has built up.`
          : `No ${kind} tests were run in the comparison period (${fmtFull(compare.previous.from)} to ${fmtFull(compare.previous.to)}), so there is nothing to compare with. Pick another period or run tests regularly (automatic monitoring helps).`,
      };
    }
    return null;
  })();

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
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config?.daily?.lastRunAt || config?.scheduler.intervalMin || config?.scheduler.lastRunAt ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-300 bg-slate-800/60'}`}>
              <Timer className="w-3.5 h-3.5" />
              {config?.daily?.lastRunAt ? `Daily auto check - last run ${fmtWhen(config.daily.lastRunAt)}` : config?.scheduler.intervalMin ? `Auto ping every ${config.scheduler.intervalMin} min` : config?.scheduler.lastRunAt ? `Last auto run ${fmtWhen(config.scheduler.lastRunAt)}` : 'Daily auto check: waiting for first run'}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config?.email.configured ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-300 bg-slate-800/60'}`}>
              <Mail className="w-3.5 h-3.5" />
              {config?.email.configured ? 'E-mail: daily summary + critical alerts' : 'E-mail alerts: not configured'}
            </span>
          </div>
        </div>
        {config?.storage.note && (
          <div className="mt-4"><Notice tone="warn">{config.storage.note}</Notice></div>
        )}
      </div>

      {/* E-mail alerts */}
      {config && (
        <Card
          title="E-mail alerts"
          icon={<Mail className={`w-4 h-4 ${config.email.configured ? 'text-emerald-400' : 'text-slate-400'}`} />}
          sub="One summary e-mail a day (everything is good / notes). A red critical alert is sent only when 5 or more ping requests in a row time out in a region."
          right={
            <button type="button" onClick={runEmailTest} disabled={!config.email.configured || testingEmail}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${config.email.configured ? 'border-cyan-400/40 text-cyan-300 bg-cyan-500/15 hover:bg-cyan-500/25 cursor-pointer' : 'border-slate-700 text-slate-500 cursor-not-allowed'}`}>
              {testingEmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Send test e-mail
            </button>
          }
        >
          <ul className="text-xs sm:text-sm text-slate-300 space-y-1.5">
            <li className="flex items-start gap-2">
              {config.email.apiKeySet ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />}
              <span>E-mail service key (<span className="font-mono">RESEND_API_KEY</span>): {config.email.apiKeySet ? 'set' : <b className="text-amber-300">missing</b>}</span>
            </li>
            <li className="flex items-start gap-2">
              {config.email.recipients.length ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />}
              <span>Recipients (<span className="font-mono">ALERT_EMAIL_TO</span>): {config.email.recipients.length ? <span className="font-mono">{config.email.recipients.join(', ')}</span> : <b className="text-amber-300">none set</b>}</span>
            </li>
            <li className="flex items-start gap-2">
              {config.email.sender ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />}
              <span>
                Sender (<span className="font-mono">ALERT_EMAIL_FROM</span>):{' '}
                {config.email.sender
                  ? <span className="font-mono">{config.email.sender}</span>
                  : <b className="text-amber-300">not set - Resend&apos;s shared test sender is used, which cannot deliver to company addresses. Set it to an address on your verified domain.</b>}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 text-cyan-400 shrink-0" />
              <span>Sends: one daily summary e-mail, plus a critical alert for 5 or more consecutive ping timeouts. Unusual values are listed in the daily summary only.</span>
            </li>
          </ul>
          {emailResult && <div className="mt-3"><Notice tone={emailResult.ok ? 'ok' : 'error'}>{emailResult.text}</Notice></div>}
        </Card>
      )}

      {/* Controls */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Test</span>
            <Pill active={kind === 'ping'} onClick={() => switchKind('ping')}>Ping</Pill>
            <Pill active={kind === 'speed'} onClick={() => switchKind('speed')}>Speed</Pill>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Period</span>
            {RANGES.map((r) => (
              <Pill key={r.key} active={period.type === 'preset' && period.range === r.key} onClick={() => choosePreset(r.key)}>{r.label}</Pill>
            ))}
            <Pill active={period.type === 'custom' || customOpen} onClick={() => setCustomOpen((o) => !o)}>
              <span className="inline-flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" /> Custom</span>
            </Pill>
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
            <a href={csvUrl(kind, period)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-200 hover:bg-slate-800/80">
              <Download className="w-3.5 h-3.5" /> CSV
            </a>
          </div>
        </div>

        {customOpen && (
          <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-slate-700/70">
            <label className="text-xs text-slate-300 flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">From</span>
              <input type="datetime-local" value={draftFrom} max={toInput(Date.now())} onChange={(e) => setDraftFrom(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white [color-scheme:dark]" />
            </label>
            <label className="text-xs text-slate-300 flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">To</span>
              <input type="datetime-local" value={draftTo} max={toInput(Date.now())} onChange={(e) => setDraftTo(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white [color-scheme:dark]" />
            </label>
            <button type="button" onClick={applyCustom} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 hover:bg-cyan-500/30 cursor-pointer">
              Apply
            </button>
            <div className="flex gap-2 flex-wrap">
              {[{ l: 'Yesterday', f: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return [d.getTime() - DAY, d.getTime()]; } },
                { l: 'This week', f: () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [d.getTime(), Date.now()]; } },
                { l: 'Last week', f: () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [d.getTime() - 7 * DAY, d.getTime()]; } }].map((q) => (
                <button key={q.l} type="button" onClick={() => { const [f, t] = q.f(); setDraftFrom(toInput(f)); setDraftTo(toInput(t)); }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-700 text-slate-300 hover:bg-slate-800/80 cursor-pointer">{q.l}</button>
              ))}
            </div>
            {customError && <div className="w-full text-xs text-red-300">{customError}</div>}
          </div>
        )}
        {period.type === 'custom' && (
          <p className="text-[11px] text-slate-400 font-mono">Showing custom period: {fmtFull(period.from)} to {fmtFull(period.to)} ({describeSpan(period.to - period.from)})</p>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {/* Anomalies */}
      <Card
        title={`Anomalies${open.length ? ` (${open.length} open)` : ''}`}
        icon={<AlertTriangle className={`w-4 h-4 ${open.length ? 'text-amber-400' : 'text-slate-400'}`} />}
        sub="Results that were far outside what the region normally shows."
        right={
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} /> Show acknowledged
          </label>
        }
      >
        {shown.length === 0 ? (
          <Notice tone="ok">
            No {showAcked ? '' : 'open '}anomalies in the selected period.
            {activeCount === 0 && metricStatus.length > 0 ? ' Note: spike/drop detection is not active yet for the selected metric (see "Detection status" below), so only the fixed packet-loss limits are being checked.' : ''}
          </Notice>
        ) : (
          <ul className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
            {shown.map((a) => {
              const ex = explainAnomaly(a, config);
              const unit = config?.metrics[a.kind]?.[a.metric]?.unit || '';
              const crit = a.severity === 'critical';
              return (
                <li key={a.id} className={`rounded-xl border p-4 ${crit ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10'} ${a.acknowledged ? 'opacity-55' : ''}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 text-[10px] font-black px-2 py-0.5 rounded-full text-white ${crit ? 'bg-red-600' : 'bg-amber-600'}`}>{a.severity.toUpperCase()}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-bold leading-snug">{a.message}</div>
                      <div className="text-[11px] text-slate-400 mt-1 font-mono">{fmtFull(a.t)} - {a.kind} test - {a.label}{a.emailStatus === 'sent' ? ' - e-mail sent' : ''}</div>
                    </div>
                    {!a.acknowledged && (
                      <button type="button" onClick={() => ack(a.id)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700/60 cursor-pointer whitespace-nowrap">
                        Acknowledge
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                    <div className="rounded-lg bg-slate-900/60 py-2"><div className="text-[10px] uppercase tracking-wider text-slate-400">Normal</div><div className="font-mono text-sm text-slate-100">{a.baselineMedian === null ? 'not known' : `${fmtNum(a.baselineMedian)} ${unit}`}</div></div>
                    <div className="rounded-lg bg-slate-900/60 py-2"><div className="text-[10px] uppercase tracking-wider text-slate-400">Measured</div><div className={`font-mono text-sm font-bold ${crit ? 'text-red-300' : 'text-amber-300'}`}>{fmtNum(a.value)} {unit}</div></div>
                    <div className="rounded-lg bg-slate-900/60 py-2"><div className="text-[10px] uppercase tracking-wider text-slate-400">Difference</div><div className="font-mono text-sm text-slate-100">{a.deviationPct === null ? '-' : `${Math.round(Math.abs(a.deviationPct))}% ${a.type === 'drop' ? 'lower' : 'higher'}`}</div></div>
                  </div>
                  <div className="mt-3 text-xs text-slate-300 leading-relaxed space-y-1">
                    <div><b className="text-slate-100">Why it was flagged: </b>{ex.why}</div>
                    <div><b className="text-slate-100">What to check: </b>{ex.check}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Detection status */}
      <Card
        title="Detection status"
        icon={<ShieldCheck className="w-4 h-4 text-cyan-400" />}
        sub={`${config?.metrics[kind]?.[metric]?.label || ''} - based on the last ${config?.detector.lookbackDays ?? 7} days, independent of the selected period`}
      >
        {metricStatus.length === 0 ? (
          <div className="text-sm text-slate-300">Loading...</div>
        ) : (
          <>
            <div className="mb-3">
              {activeCount === 0 ? (
                <Notice tone="warn">
                  <b>Spike/drop detection is not active yet.</b> Each region needs at least {config?.detector.minBaseline ?? 8} earlier results before the system knows
                  what &quot;normal&quot; is. Until then only the fixed packet-loss limits can raise alerts. Run more tests or turn on automatic monitoring.
                </Notice>
              ) : activeCount < metricStatus.length ? (
                <Notice tone="info">Detection is active for {activeCount} of {metricStatus.length} regions. The others are still collecting data.</Notice>
              ) : (
                <Notice tone="ok">Detection is active for all regions.</Notice>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="py-2 pr-3">Region</th><th className="pr-3">Detector</th>
                    <th className="pr-3 text-right">Normal</th>
                    <th className="pr-3 text-right">Warning when {metricStatus[0]?.bad === 'low' ? 'below' : 'above'}</th>
                    <th className="pr-3 text-right">Critical when {metricStatus[0]?.bad === 'low' ? 'below' : 'above'}</th>
                    <th className="pr-3 text-right">Latest result</th><th className="text-right">Latest is</th>
                  </tr>
                </thead>
                <tbody>
                  {metricStatus.map((r) => (
                    <tr key={r.region} className="border-b border-slate-800 text-slate-200">
                      <td className="py-2 pr-3 font-mono font-bold" style={{ color: REGION_COLORS[r.region] }}>{r.region}</td>
                      <td className="pr-3">
                        {r.state === 'active' && <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" /> Active</span>}
                        {r.state === 'learning' && <span className="inline-flex items-center gap-1 text-amber-300"><GraduationCap className="w-3.5 h-3.5" /> Learning ({r.samples}/{r.needed})</span>}
                        {r.state === 'no-data' && <span className="text-slate-500">No data yet</span>}
                      </td>
                      <td className="pr-3 text-right font-mono">{r.normal === null ? '-' : `${fmtNum(r.normal)} ${r.unit}`}</td>
                      <td className="pr-3 text-right font-mono text-amber-300">{r.warningLimit === null ? '-' : `${fmtNum(r.warningLimit)} ${r.unit}`}</td>
                      <td className="pr-3 text-right font-mono text-red-300">{r.criticalLimit === null ? '-' : `${fmtNum(r.criticalLimit)} ${r.unit}`}</td>
                      <td className="pr-3 text-right font-mono">{r.latest === null ? '-' : `${fmtNum(r.latest)} ${r.unit}`}{r.latestAt ? <span className="block text-[10px] text-slate-500">{fmtWhen(r.latestAt)}</span> : null}</td>
                      <td className="text-right">
                        {r.latestState === null ? '-' : (
                          <span className={`px-2 py-0.5 rounded-full border font-bold ${r.latestState === 'normal' ? VERDICT_STYLE.stable : r.latestState === 'warning' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-red-500/15 text-red-300 border-red-500/40'}`}>
                            {r.latestState === 'normal' ? 'Normal' : r.latestState === 'warning' ? 'Warning' : 'Critical'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {metric === 'packetLossPercent' && config && (
              <p className="mt-3 text-[11px] text-slate-400">Packet loss also has fixed limits that always apply: warning from {config.detector.lossWarnPct}%, critical from {config.detector.lossCritPct}%, and 100% is an outage.</p>
            )}
          </>
        )}
      </Card>

      {/* Trend */}
      <Card
        title={history ? `${history.def.label} over time (${metricUnit})` : 'Trend'}
        icon={<Activity className="w-4 h-4 text-cyan-400" />}
        sub={periodLabel}
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
          <>
            {history.sampleCount < 5 && (
              <div className="mb-3"><Notice tone="info">Only {history.sampleCount} result{history.sampleCount === 1 ? '' : 's'} in this period, so the chart is sparse. It becomes more useful as more tests are stored.</Notice></div>
            )}
            {region === 'all' && history.sampleCount >= 5 && (
              <p className="text-[11px] text-slate-500 mb-2">Select a single region to also see its normal value and where alerts start.</p>
            )}
            <TrendChart data={history} />
            <div className="mt-2 text-[11px] text-slate-500 font-mono">{history.sampleCount} results - each point is the average of a {Math.round(history.bucketMs / 60000)}-minute window</div>
          </>
        ) : history ? (
          <Notice tone="warn">
            No {kind} results were stored for this period.{' '}
            {history.firstSampleAt
              ? history.firstSampleAt > history.to
                ? `History for this test only starts on ${fmtFull(history.firstSampleAt)}, which is after the selected period.`
                : `History for this test starts on ${fmtFull(history.firstSampleAt)}. No tests were run during the selected period.`
              : `Run a ${kind === 'ping' ? 'Ping Monitoring' : 'Speed Test'} session${kind === 'ping' ? ', or turn on automatic monitoring (MONITOR_INTERVAL_MIN)' : ''} and results will appear here.`}
          </Notice>
        ) : null}
      </Card>

      {/* Comparison */}
      <Card
        title="Comparison"
        icon={<ArrowUpRight className="w-4 h-4 text-cyan-400" />}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Pill active={effectiveMode === 'previous'} onClick={() => setMode('previous')}>vs previous period</Pill>
            <Pill active={effectiveMode === 'lastweek'} onClick={() => setMode('lastweek')} disabled={!lastWeekPossible}
              title={lastWeekPossible ? undefined : 'Only available for periods up to 7 days'}>vs same time last week</Pill>
          </div>
        }
      >
        {compare && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-stretch gap-3">
              <div className="flex-1 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Current period</div>
                <div className="text-sm font-mono text-white mt-1">{fmtFull(compare.current.from)}</div>
                <div className="text-sm font-mono text-white">to {fmtFull(compare.current.to)}</div>
                <div className="text-[11px] text-slate-400 mt-1">The period you selected above.</div>
              </div>
              <div className="hidden md:flex items-center text-slate-500"><ArrowRight className="w-5 h-5 rotate-180" /></div>
              <div className="flex-1 rounded-xl border border-slate-600 bg-slate-800/40 p-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">Compared with</div>
                <div className="text-sm font-mono text-white mt-1">{fmtFull(compare.previous.from)}</div>
                <div className="text-sm font-mono text-white">to {fmtFull(compare.previous.to)}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {compare.mode === 'lastweek' ? 'The same hours, exactly 7 days earlier.' : `The ${describeSpan(compare.current.to - compare.current.from)} directly before the current period.`}
                </div>
              </div>
            </div>

            {compare.modeNote && <Notice tone="info">{compare.modeNote}</Notice>}
            {compareProblem && <Notice tone={compareProblem.tone}>{compareProblem.text}</Notice>}

            {!compareProblem && (
              <Notice tone={worse > 0 ? 'warn' : 'ok'}>
                Compared with the earlier period: {worse} metric{worse === 1 ? '' : 's'} got worse, {better} improved, {stable} stayed about the same (within 10%).
              </Notice>
            )}

            {compareRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-700">
                      <th className="py-2 pr-3">Region</th><th className="pr-3">Metric</th>
                      <th className="pr-3 text-right">Before (average)</th><th className="pr-3 text-right">Now (average)</th>
                      <th className="pr-3 text-right cursor-help" title="The bad end of the current period: the highest value for latency, jitter and loss, the lowest value for speed (worst 5% of results).">Worst case now</th>
                      <th className="text-right">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map((r) => (
                      <tr key={`${r.region}-${r.metric}`} className="border-b border-slate-800 text-slate-200">
                        <td className="py-2 pr-3 font-mono font-bold" style={{ color: REGION_COLORS[r.region] }}>{r.region}</td>
                        <td className="pr-3">{r.label}</td>
                        <td className="pr-3 text-right font-mono">{r.previous ? `${fmtNum(r.previous.avg)} ${r.unit}` : <span className="text-slate-500">no data</span>}</td>
                        <td className="pr-3 text-right font-mono">{r.current ? `${fmtNum(r.current.avg)} ${r.unit}` : <span className="text-slate-500">no data</span>}</td>
                        <td className="pr-3 text-right font-mono">{r.worstNow !== null ? `${fmtNum(r.worstNow)} ${r.unit}` : '-'}</td>
                        <td className="text-right">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-mono font-bold ${VERDICT_STYLE[r.verdict]}`}>
                            {r.verdict === 'worse' && <ArrowUpRight className="w-3 h-3" />}
                            {r.verdict === 'better' && <ArrowDownRight className="w-3 h-3" />}
                            {r.deltaPct === null ? 'cannot compare' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}% ${r.verdict}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* How it works */}
      {config && (
        <Card title="How anomalies are detected" icon={<Info className="w-4 h-4 text-cyan-400" />}>
          <ul className="text-xs sm:text-sm text-slate-300 leading-relaxed space-y-1.5 list-disc pl-5">
            <li>
              For every region and metric the system learns what is <b>normal</b>: the middle value of the last {config.detector.lookbackDays} days
              (needs at least {config.detector.minBaseline} earlier results; until then the region is &quot;learning&quot;).
            </li>
            <li>
              A new result is flagged when it is much worse than normal (higher latency, jitter or loss; lower speed), far outside the usual ups and
              downs, <b>and</b> at least {config.detector.minChangePct}% different. It is <b>critical</b> when it is at least {config.detector.minChangePct * 2}% different and extremely far out.
            </li>
            <li>
              Packet loss also has fixed limits: warning from {config.detector.lossWarnPct}%, critical from {config.detector.lossCritPct}%, and 100% is reported as an outage.
            </li>
            <li>Better-than-normal results (faster speed, lower latency) are never flagged.</li>
            <li>Critical anomalies are e-mailed (at most one e-mail per region and metric every {config.email.cooldownMin} minutes). Every anomaly also appears here and as a pop-up after a test.</li>
          </ul>
        </Card>
      )}
    </div>
  );
};
