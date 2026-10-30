import React, { useState, useEffect, useRef } from 'react';
import {
  type RegionId,
  type RegionPingResult,
  type PingSession,
  type SessionSummary,
} from '../types/ping';
import { UNIFIED_ENDPOINTS } from '../config/endpoints';
import {
  executePingSession,
  createInitialRegionalResults,
} from '../services/pingService';
import { executeRealRegionalPing } from '../services/regionalApi';
import { SummaryCards } from '../components/SummaryCards';
import { RegionCard } from '../components/RegionCard';
import { PacketInspectionModal } from '../components/PacketInspectionModal';
import { SessionDetailModal } from '../components/SessionDetailModal';
import {
  Play,
  RotateCcw,
  SlidersHorizontal,
  ShieldCheck,
  Radio,
  Server,
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  History,
  ChevronRight,
  ChevronDown,
  Gauge,
} from 'lucide-react';

import {
  loadStoredPingSessions,
  loadAllPingSessions,
  persistPingSession,
  clearAllPingSessions,
  removePingSession,
  formatSessionDateTime,
} from '../services/pingHistoryStorage';

interface PingMonitorPageProps {
  onTestRunningChange?: (running: boolean) => void;
  onSwitchToSpeedTest?: () => void;
  disableFloatingAnimation?: boolean;
  hasTestedSpeedBefore?: boolean;
  onPingCompleted?: () => void;
}

export const PingMonitorPage: React.FC<PingMonitorPageProps> = ({
  onTestRunningChange,
  onSwitchToSpeedTest,
  disableFloatingAnimation = false,
  hasTestedSpeedBefore = false,
  onPingCompleted,
}) => {
  const [regionalResults, setRegionalResults] = useState<Record<RegionId, RegionPingResult>>(() =>
    createInitialRegionalResults('8.8.8.8')
  );
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [singleRunningId, setSingleRunningId] = useState<RegionId | null>(null);
  const [lastSessionTime, setLastSessionTime] = useState<string | null>(null);
  const [targetIp, setTargetIp] = useState('8.8.8.8');
  const [pingCount, setPingCount] = useState(30);

  // Modals & Storage
  const [inspectModalResult, setInspectModalResult] = useState<RegionPingResult | null>(null);
  const [selectedDetailSession, setSelectedDetailSession] = useState<PingSession | null>(null);
  const [historySessions, setHistorySessions] = useState<PingSession[]>(() => loadStoredPingSessions());
  const [showHistory, setShowHistory] = useState(false);
  const [hasJustFinishedRun, setHasJustFinishedRun] = useState(false);
  const [hasCompletedAnyRun, setHasCompletedAnyRun] = useState(false);
  const [showFloatingPrompt, setShowFloatingPrompt] = useState(false);

  const bottomCtaRef = useRef<HTMLDivElement>(null);
  const historySectionRef = useRef<HTMLDivElement>(null);
  const isRunning = isRunningAll || singleRunningId !== null;

  useEffect(() => {
    onTestRunningChange?.(isRunning);
  }, [isRunning, onTestRunningChange]);

  // Clean up on unmount or tab switch
  useEffect(() => {
    return () => {
      setHasJustFinishedRun(false);
      setShowFloatingPrompt(false);
    };
  }, []);

  // When user reaches bottom CTA or scrolls down, dismiss the floating prompt
  useEffect(() => {
    if (!showFloatingPrompt || !bottomCtaRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShowFloatingPrompt(false);
          }
        });
      },
      { threshold: 0.15 }
    );
    observer.observe(bottomCtaRef.current);
    return () => observer.disconnect();
  }, [showFloatingPrompt]);

  const handleFloatingClick = () => {
    setShowFloatingPrompt(false);
    bottomCtaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleToggleHistory = () => {
    if (!showHistory) {
      setShowHistory(true);
      setTimeout(() => {
        historySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    } else {
      historySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Load persistent sessions for history drawer only; do NOT pre-populate live test summary on initial load
  useEffect(() => {
    let isMounted = true;
    loadAllPingSessions().then((sessions) => {
      if (!isMounted) return;
      if (sessions && sessions.length > 0) {
        setHistorySessions(sessions);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleRunAll = async () => {
    if (isRunning) return;

    setHasJustFinishedRun(false);
    setShowFloatingPrompt(false);
    setIsRunningAll(true);
    try {
      const session = await executePingSession({
        targetIp,
        pingCount,
        onRegionProgress: (rid, result) => {
          setRegionalResults((prev) => ({ ...prev, [rid]: result }));
        },
      });

      setRegionalResults(session.regions);
      setSessionSummary(session.summary);
      setLastSessionTime(session.completedAt || new Date().toISOString());
      setHasCompletedAnyRun(true);
      setHasJustFinishedRun(true);
      setShowFloatingPrompt(true);
      onPingCompleted?.();

      // Save session across LocalStorage, server API, and Firestore
      persistPingSession(session).then((updated) => {
        setHistorySessions(updated);
      });
    } catch (err: any) {
      console.error('Ping session error:', err);
    } finally {
      setIsRunningAll(false);
    }
  };

  const handleRunSingle = async (regionId: string) => {
    setShowFloatingPrompt(false);
    const rid = regionId as RegionId;
    if (isRunning) return;

    setSingleRunningId(rid);
    setRegionalResults((prev) => ({
      ...prev,
      [rid]: {
        ...prev[rid],
        status: 'Running',
        startedAt: new Date().toISOString(),
      },
    }));

    try {
      const result = await executeRealRegionalPing({
        regionId: rid,
        targetIp,
        count: pingCount,
        sessionId: `single_${Date.now()}`,
      });

      setRegionalResults((prev) => ({ ...prev, [rid]: result }));
      setLastSessionTime(result.completedAt || new Date().toISOString());
      setHasCompletedAnyRun(true);
      setHasJustFinishedRun(true);
      onPingCompleted?.();
    } catch (err: any) {
      const ep = UNIFIED_ENDPOINTS.find((e) => e.serverCode === rid);
      const isMissingConfig = (err.message || '').includes('not configured');
      setRegionalResults((prev) => ({
        ...prev,
        [rid]: {
          regionId: rid,
          regionName: `${rid} — ${ep?.fullName || rid}`,
          targetIp,
          status: isMissingConfig ? 'Unavailable' : 'Failed',
          requestsSent: 0,
          successfulReplies: 0,
          failedRequests: pingCount,
          packetLossPercent: 100,
          minLatencyMs: null,
          avgLatencyMs: null,
          maxLatencyMs: null,
          jitterMs: null,
          durationMs: null,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          errorDetails: err.message || 'Regional endpoint connection failure',
          packets: [],
        },
      }));
      setHasCompletedAnyRun(true);
      setHasJustFinishedRun(true);
      onPingCompleted?.();
    } finally {
      setSingleRunningId(null);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#141e33]/90 border border-slate-700/80 rounded-2xl p-6 sm:p-7 backdrop-blur-xl shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
              ICMP Probing Platform
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-xs text-slate-300 font-medium">Target 8.8.8.8 Standardized</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Multi-Region Ping Monitor
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl font-normal leading-relaxed">
            Concurrent round-trip latency and packet loss benchmarking to Google DNS (8.8.8.8) dispatched across authorized data centers:<br />
            <strong className="text-cyan-300"> IN-DC01 (TATA Node)</strong> and <strong className="text-blue-300">IN-DC02 (ACT Node)</strong>
            <span className="text-slate-400"> (Authorized on Vercel deployment)</span>.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          <button
            onClick={handleToggleHistory}
            type="button"
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              showHistory
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-md shadow-indigo-600/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-600'
            }`}
          >
            <History className="w-4 h-4 text-cyan-400" />
            <span>Session History ({historySessions.length})</span>
          </button>
        </div>
      </div>

      {/* Control Action Bar */}
      <section className="bg-gradient-to-r from-[#141e33] to-[#16233f] border border-slate-700/80 rounded-2xl p-6 sm:p-7 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                <Radio className="w-3.5 h-3.5 text-indigo-300" />
                Active Probes
              </span>
              <span className="text-xs font-mono font-semibold text-slate-300">
                Target: 8.8.8.8 (Google DNS) • 30 Packets • {UNIFIED_ENDPOINTS.length} Permitted Nodes
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {isRunningAll
                ? `Dispatching ICMP Probes across ${UNIFIED_ENDPOINTS.length} Permitted Regions...`
                : singleRunningId
                ? `Testing ${singleRunningId}...`
                : `Execute Latency Benchmark (${UNIFIED_ENDPOINTS.map((e) => e.serverCode).join(' & ')})`}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed font-normal">
              Dispatches native ping process execution through regional endpoints and push agents.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunAll}
              disabled={isRunning}
              type="button"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl font-extrabold text-base bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:via-blue-500 hover:to-indigo-500 text-white shadow-xl shadow-cyan-500/20 transition-all duration-200 cursor-pointer disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            >
              {isRunningAll ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Probing Permitted Regions...</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-white" />
                  <span>Run Ping ({UNIFIED_ENDPOINTS.map((e) => e.serverCode).join(' & ')})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Summary Cards */}
      <SummaryCards
        summary={sessionSummary}
        lastSessionTime={lastSessionTime}
        isRunning={isRunning}
      />

      {/* History Drawer (if open) with clear Date & Time and Details button */}
      {showHistory && (
        <section
          id="session-history"
          ref={historySectionRef}
          className="bg-[#141e33] border border-indigo-500/40 rounded-2xl p-6 backdrop-blur-xl space-y-4 animate-fade-in shadow-xl"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-700 flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Recent Ping Test Sessions
              </h3>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Cloud &amp; Server Synced
              </span>
            </div>
            <div className="flex items-center gap-2">
              {historySessions.length > 0 && (
                <button
                  onClick={() => setSelectedDetailSession(historySessions[0])}
                  type="button"
                  className="text-xs text-cyan-300 hover:text-white bg-cyan-500/20 hover:bg-cyan-500/30 px-2.5 py-1 rounded-lg border border-cyan-400/30 transition-colors cursor-pointer font-bold"
                >
                  Last Session Details
                </button>
              )}
              <span className="text-xs text-slate-400 font-mono">
                {historySessions.length} session{historySessions.length === 1 ? '' : 's'} logged
              </span>
              {historySessions.length > 0 && (
                <button
                  onClick={async () => {
                    await clearAllPingSessions();
                    setHistorySessions([]);
                  }}
                  type="button"
                  className="text-xs text-rose-400 hover:text-rose-300 transition-colors ml-2 cursor-pointer font-semibold"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {historySessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 font-mono">
              No sessions logged yet. Click &quot;Run Ping (All 4 Regions)&quot; to begin.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-80 overflow-y-auto">
              {historySessions.map((sess) => {
                const dt = formatSessionDateTime(sess.startedAt);

                return (
                  <div key={sess.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-800/30 px-2 rounded-xl transition-colors">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-sans font-bold text-slate-100">{dt.dateFull}</span>
                        <span className="font-mono font-bold text-cyan-300 text-xs bg-slate-900/90 px-2 py-0.5 rounded border border-cyan-500/40 tracking-wider shadow-inner">
                          {dt.timeWithSeconds}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">({dt.relative})</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 mt-1 block">
                        ID: {sess.id} • Target: {sess.targetIp} • {sess.pingCount} pkts
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-3 font-mono">
                        <span className="text-emerald-400 font-semibold" title="Successful regions">
                          ✓ {sess.summary?.successfulRegions ?? 0}
                        </span>
                        <span className="text-rose-400 font-semibold" title="Failed regions">
                          ✕ {sess.summary?.failedOrUnavailableRegions ?? 0}
                        </span>
                        <span className="text-cyan-400 font-bold">
                          Avg: {sess.summary?.overallAvgLatencyMs ? `${sess.summary.overallAvgLatencyMs}ms` : '—'}
                        </span>
                      </div>

                      <button
                        onClick={() => setSelectedDetailSession(sess)}
                        type="button"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40 transition-colors cursor-pointer shadow-xs shrink-0"
                      >
                        <span>Details</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const updated = await removePingSession(sess.id);
                          setHistorySessions(updated);
                        }}
                        type="button"
                        title="Delete this session"
                        className="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors cursor-pointer text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Permitted Regional Ping Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
              Permitted Regional ICMP Telemetry
            </h2>
            <p className="text-xs text-slate-400">
              Live round-trip metrics to 8.8.8.8. Click &quot;Packets&quot; to inspect individual sequences.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/30">
            {UNIFIED_ENDPOINTS.length} Permitted Nodes Active
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {UNIFIED_ENDPOINTS.map((endpoint) => {
            const rid = endpoint.serverCode as RegionId;
            return (
              <RegionCard
                key={rid}
                result={regionalResults[rid]}
                totalPlannedCount={pingCount}
                onInspectPackets={(res) => setInspectModalResult(res)}
                onRunSingle={handleRunSingle}
                isRunning={singleRunningId === rid}
              />
            );
          })}
        </div>
      </section>

      {/* Floating Animated Prompt to draw user down: short, cute, and disappears on click or at bottom */}
      {!disableFloatingAnimation && showFloatingPrompt && !isRunning && onSwitchToSpeedTest && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={handleFloatingClick}
            type="button"
            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/60 border border-cyan-400/40 cursor-pointer transition-transform hover:scale-105 active:scale-95"
            title="Scroll to Next Benchmark"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
            <span>Next Test</span>
            <ChevronDown className="w-3.5 h-3.5 text-cyan-200 group-hover:translate-y-0.5 transition-transform animate-bounce" />
          </button>
        </div>
      )}

      {/* Bottom Completion Invitation: Next Step Recommendation (Clean without animations if second app test) */}
      {(hasCompletedAnyRun || hasJustFinishedRun) && !isRunning && onSwitchToSpeedTest && (
        <section
          ref={bottomCtaRef}
          className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-gradient-to-r from-slate-900 via-[#12233f] to-[#122e44] border-2 border-cyan-500/50 shadow-2xl shadow-cyan-950/60 ${disableFloatingAnimation ? '' : 'animate-fade-in'}`}
        >
          {/* Animated pulsing glow effects - only for first test */}
          {!disableFloatingAnimation && (
            <>
              <div className="absolute -top-24 -right-24 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
              <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
            </>
          )}

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-400 flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/20">
                <Gauge className={`w-7 h-7 text-cyan-300 ${disableFloatingAnimation ? '' : 'animate-pulse'}`} />
              </div>
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                    <span className={`w-2 h-2 rounded-full bg-cyan-400 ${disableFloatingAnimation ? '' : 'animate-ping'} inline-block`} />
                    {hasTestedSpeedBefore ? 'Speed Test Completed' : 'Recommended Next Benchmark'}
                  </span>
                  <span className="text-xs text-slate-400">
                    {hasTestedSpeedBefore ? '• Want to test again?' : '• Bandwidth & Throughput Audit'}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {hasTestedSpeedBefore
                    ? 'Want to test Speed & Bandwidth again?'
                    : 'Ping Probes Complete! Want to measure Speed & Bandwidth next?'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {hasTestedSpeedBefore
                    ? "You previously completed a speed test in this session. Want to run the Speed Test again to compare live download/upload megabits per second and pipeline latency?"
                    : 'You’ve benchmarked ICMP round-trip latency and packet loss across all 4 regions. Next, evaluate actual real-time download/upload megabits per second and pipeline latency using the Multi-Region Speed Test.'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <button
                onClick={() => {
                  setHasJustFinishedRun(false);
                  onSwitchToSpeedTest?.();
                }}
                type="button"
                className="group inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 border border-cyan-400/40 shadow-xl shadow-cyan-600/30 hover:shadow-cyan-600/50 hover:scale-[1.03] active:scale-[0.98] transition-all cursor-pointer"
              >
                {hasTestedSpeedBefore ? (
                  <>
                    <RotateCcw className="w-4 h-4 text-white group-hover:-rotate-90 transition-transform" />
                    <span>Run Speed Test Again</span>
                  </>
                ) : (
                  <>
                    <Gauge className="w-4 h-4 text-white group-hover:rotate-12 transition-transform" />
                    <span>Launch Speed Test App</span>
                  </>
                )}
                <ChevronRight className="w-4 h-4 text-white group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Packet Inspection Modal */}
      <PacketInspectionModal
        onClose={() => setInspectModalResult(null)}
        result={inspectModalResult}
      />

      {/* Session Details Modal */}
      <SessionDetailModal
        session={selectedDetailSession}
        onClose={() => setSelectedDetailSession(null)}
      />
    </div>
  );
};
