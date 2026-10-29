import React, { useState, useEffect, useRef } from 'react';
import { UNIFIED_ENDPOINTS, UnifiedEndpoint } from '../config/endpoints';
import { speedTestEngine } from '../services/speedTestEngine';
import { LiveMetrics, SpeedTestResult, TestStage, RegionState } from '../types/speed';
import { SpeedGauge } from '../components/SpeedGauge';
import { RegionResultSection } from '../components/RegionResultSection';
import {
  Play,
  Square,
  RotateCcw,
  ShieldCheck,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Gauge,
  History,
  ChevronRight,
} from 'lucide-react';
import { type SpeedTestSession } from '../types/speedSession';
import {
  loadStoredSpeedSessions,
  loadAllSpeedSessions,
  persistSpeedSession,
  clearAllSpeedSessions,
  removeSpeedSession,
  formatSessionDateTime,
} from '../services/speedHistoryStorage';
import { SpeedSessionDetailModal } from '../components/SpeedSessionDetailModal';

interface SpeedTestPageProps {
  onTestRunningChange?: (running: boolean) => void;
}

export const SpeedTestPage: React.FC<SpeedTestPageProps> = ({ onTestRunningChange }) => {
  const [regionStates, setRegionStates] = useState<RegionState[]>(() =>
    UNIFIED_ENDPOINTS.map((endpoint) => ({
      endpoint,
      status: 'waiting',
      stage: 'idle',
      liveMetrics: null,
      result: null,
      errorMessage: null,
    }))
  );

  const [activeRegionIndex, setActiveRegionIndex] = useState<number | null>(null);
  const [isSequenceRunning, setIsSequenceRunning] = useState<boolean>(false);
  const [hasCompletedRun, setHasCompletedRun] = useState<boolean>(false);

  // History & Storage
  const [historySessions, setHistorySessions] = useState<SpeedTestSession[]>(() => loadStoredSpeedSessions());
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [selectedDetailSession, setSelectedDetailSession] = useState<SpeedTestSession | null>(null);
  const sessionStartTimeRef = useRef<string | null>(null);

  const isCancelledRef = useRef<boolean>(false);
  const activeIndexRef = useRef<number | null>(null);
  const testSectionRef = useRef<HTMLDivElement>(null);

  activeIndexRef.current = activeRegionIndex;

  useEffect(() => {
    onTestRunningChange?.(isSequenceRunning);
  }, [isSequenceRunning, onTestRunningChange]);

  // Load persistent speed test sessions from server API & Firestore across reloads and shared links
  useEffect(() => {
    let isMounted = true;
    loadAllSpeedSessions().then((sessions) => {
      if (!isMounted) return;
      if (sessions && sessions.length > 0) {
        setHistorySessions(sessions);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      speedTestEngine.stopTest();
    };
  }, []);

  const handleStartSequentialTest = async () => {
    if (isSequenceRunning) return;

    isCancelledRef.current = false;
    setIsSequenceRunning(true);
    setHasCompletedRun(false);
    sessionStartTimeRef.current = new Date().toISOString();

    setRegionStates(
      UNIFIED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        status: 'waiting',
        stage: 'idle',
        liveMetrics: null,
        result: null,
        errorMessage: null,
      }))
    );

    testSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    for (let i = 0; i < UNIFIED_ENDPOINTS.length; i++) {
      if (isCancelledRef.current) break;

      const currentEndpoint = UNIFIED_ENDPOINTS[i];
      setActiveRegionIndex(i);

      setRegionStates((prev) =>
        prev.map((region, idx) =>
          idx === i
            ? {
                ...region,
                status: 'testing',
                stage: 'ping',
                errorMessage: null,
                liveMetrics: {
                  stage: 'ping',
                  progressPercent: 2,
                  pingMs: null,
                  jitterMs: null,
                  currentDownloadMbps: null,
                  currentUploadMbps: null,
                  pingProgress: 5,
                  jitterProgress: 0,
                  downloadProgress: 0,
                  uploadProgress: 0,
                },
              }
            : region
        )
      );

      try {
        await speedTestEngine.startTest(currentEndpoint, {
          onProgress: (metrics) => {
            if (isCancelledRef.current) return;
            setRegionStates((prev) =>
              prev.map((region, idx) =>
                idx === i
                  ? {
                      ...region,
                      stage: metrics.stage,
                      liveMetrics: { ...metrics },
                    }
                  : region
              )
            );
          },
          onComplete: (result) => {
            if (isCancelledRef.current) return;
            setRegionStates((prev) =>
              prev.map((region, idx) =>
                idx === i
                  ? {
                      ...region,
                      status: 'completed',
                      stage: 'complete',
                      result,
                    }
                  : region
              )
            );
          },
          onError: (friendlyErrorMessage) => {
            if (isCancelledRef.current) return;
            setRegionStates((prev) =>
              prev.map((region, idx) =>
                idx === i
                  ? {
                      ...region,
                      status: 'failed',
                      stage: 'error',
                      errorMessage: friendlyErrorMessage,
                      liveMetrics: null,
                    }
                  : region
              )
            );
          },
          onCancelled: () => {},
        });
      } catch (err: any) {
        if (isCancelledRef.current) break;
        setRegionStates((prev) =>
          prev.map((region, idx) =>
            idx === i
              ? {
                  ...region,
                  status: 'failed',
                  stage: 'error',
                  errorMessage: err.message || 'Direct browser connection failed.',
                  liveMetrics: null,
                }
              : region
          )
        );
      }

      if (isCancelledRef.current) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    setIsSequenceRunning(false);
    setActiveRegionIndex(null);

    if (!isCancelledRef.current) {
      setHasCompletedRun(true);

      setRegionStates((finalStates) => {
        const completedRegionsList = finalStates.filter((r) => r.status === 'completed');
        const failedRegionsList = finalStates.filter((r) => r.status === 'failed');

        const downloads = completedRegionsList.map((r) => r.result?.downloadMbps || 0).filter((v) => v > 0);
        const uploads = completedRegionsList.map((r) => r.result?.uploadMbps || 0).filter((v) => v > 0);
        const pings = completedRegionsList.map((r) => r.result?.pingMs || 0).filter((v) => v > 0);

        const avgDownloadMbps = downloads.length ? downloads.reduce((a, b) => a + b, 0) / downloads.length : 0;
        const avgUploadMbps = uploads.length ? uploads.reduce((a, b) => a + b, 0) / uploads.length : 0;
        const avgPingMs = pings.length ? pings.reduce((a, b) => a + b, 0) / pings.length : 0;
        const peakDownloadMbps = downloads.length ? Math.max(...downloads) : 0;

        const regionsMap: Record<string, any> = {};
        for (const reg of finalStates) {
          regionsMap[reg.endpoint.serverCode] = {
            serverCode: reg.endpoint.serverCode,
            name: reg.endpoint.name,
            country: reg.endpoint.country,
            status: reg.status,
            downloadMbps: reg.result?.downloadMbps ?? null,
            uploadMbps: reg.result?.uploadMbps ?? null,
            pingMs: reg.result?.pingMs ?? null,
            jitterMs: reg.result?.jitterMs ?? null,
            errorMessage: reg.errorMessage ?? null,
          };
        }

        const speedSession: SpeedTestSession = {
          id: `spd_${Date.now()}`,
          startedAt: sessionStartTimeRef.current || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          regions: regionsMap,
          summary: {
            totalRegions: finalStates.length,
            completedRegions: completedRegionsList.length,
            failedRegions: failedRegionsList.length,
            avgDownloadMbps,
            avgUploadMbps,
            avgPingMs,
            peakDownloadMbps,
          },
        };

        persistSpeedSession(speedSession).then((updated) => {
          setHistorySessions(updated);
        });

        return finalStates;
      });
    }
  };

  const handleStopTest = () => {
    isCancelledRef.current = true;
    speedTestEngine.stopTest();
    setIsSequenceRunning(false);

    const currentIdx = activeIndexRef.current;
    if (currentIdx !== null) {
      setRegionStates((prev) =>
        prev.map((region, idx) =>
          idx === currentIdx && region.status === 'testing'
            ? {
                ...region,
                status: 'waiting',
                stage: 'idle',
                liveMetrics: null,
              }
            : region
        )
      );
    }

    setActiveRegionIndex(null);
  };

  const activeRegion = activeRegionIndex !== null ? regionStates[activeRegionIndex] : null;
  const activeMetrics = activeRegion?.liveMetrics || null;
  const activeStage: TestStage = activeRegion?.stage || (hasCompletedRun ? 'complete' : 'idle');

  const completedCount = regionStates.filter((r) => r.status === 'completed').length;
  const failedCount = regionStates.filter((r) => r.status === 'failed').length;
  const waitingCount = regionStates.filter((r) => r.status === 'waiting').length;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Top Header & Overview */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#141e33]/90 border border-slate-700/80 rounded-2xl p-6 sm:p-7 backdrop-blur-xl shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
              Sequential Speed Benchmarking
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-xs text-slate-300 font-medium">LibreSpeed Multi-Region Pipeline</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            All Region Network Speed Test
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl font-normal leading-relaxed">
            Sequential real-time speed measurement across all four dedicated data center servers:<br></br>
            <strong className="text-cyan-300"> IN-DC01 (TATA Node)</strong> →{' '}
            <strong className="text-blue-300">IN-DC02 (ACT Node)</strong> →{' '}
            <strong className="text-emerald-300">LK-DC01 (SLT Mobitel)</strong> →{' '}
            <strong className="text-indigo-300">SG-DC01 (Singtel)</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => setShowHistory(!showHistory)}
            type="button"
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              showHistory
                ? 'bg-cyan-600 text-white border-cyan-400 shadow-md shadow-cyan-600/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-600'
            }`}
          >
            <History className="w-4 h-4 text-cyan-400" />
            <span>Session History ({historySessions.length})</span>
          </button>
        </div>
      </div>

      {/* Control Bar & Sequence Pipeline */}
      <section
        ref={testSectionRef}
        className="bg-gradient-to-r from-[#141e33] to-[#16233f] border border-slate-700/80 rounded-2xl p-6 sm:p-7 backdrop-blur-xl shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                Sequential Pipeline
              </span>
              <span className="text-xs font-mono font-semibold text-slate-300">
                {isSequenceRunning
                  ? `Testing Region ${(activeRegionIndex ?? 0) + 1} of 4`
                  : hasCompletedRun
                  ? 'All 4 Tests Finished'
                  : 'Ready to Run'}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {isSequenceRunning && activeRegion
                ? `Benchmarking ${activeRegion.endpoint.serverCode} (${activeRegion.endpoint.name})`
                : hasCompletedRun
                ? 'All 4 Regional Tests Processed'
                : 'Start Sequential Benchmark'}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed font-normal">
              {isSequenceRunning
                ? 'Tests run sequentially in strict order. Real-time chunked telemetry.'
                : 'Runs sequentially across all servers using authentic LibreSpeed streams.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isSequenceRunning ? (
              <button
                onClick={handleStopTest}
                type="button"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold text-base bg-red-600 hover:bg-red-500 text-white shadow-xl shadow-red-600/30 transition-all duration-200 cursor-pointer active:scale-95"
              >
                <Square className="w-4 h-4 fill-white" />
                <span>Stop Test</span>
              </button>
            ) : (
              <button
                onClick={handleStartSequentialTest}
                type="button"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl font-bold text-base bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:via-blue-500 hover:to-indigo-500 text-white shadow-xl shadow-cyan-500/25 transition-all duration-200 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                {hasCompletedRun ? (
                  <>
                    <RotateCcw className="w-5 h-5" />
                    <span>Run All Tests Again</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-white" />
                    <span>Start Speed Test</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* 4 Pipeline Steps */}
        <div className="mt-6 pt-6 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {regionStates.map((reg, idx) => {
            const isCurrent = activeRegionIndex === idx;
            return (
              <div
                key={reg.endpoint.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  isCurrent
                    ? 'bg-cyan-950/30 border-cyan-500/60 ring-1 ring-cyan-500/40 shadow-lg shadow-cyan-500/10'
                    : reg.status === 'completed'
                    ? 'bg-slate-900/90 border-emerald-500/40'
                    : reg.status === 'failed'
                    ? 'bg-slate-900/90 border-rose-500/40'
                    : 'bg-slate-950/60 border-slate-800/80'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-slate-400 font-semibold uppercase tracking-wider">
                    Region 0{idx + 1}
                  </span>
                  {reg.status === 'waiting' && (
                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" /> Waiting
                    </span>
                  )}
                  {reg.status === 'testing' && (
                    <span className="text-[10px] font-mono text-cyan-300 font-bold flex items-center gap-1 animate-pulse">
                      <Activity className="w-2.5 h-2.5 text-cyan-400 animate-spin" /> Testing
                    </span>
                  )}
                  {reg.status === 'completed' && (
                    <span className="text-[10px] font-mono text-emerald-300 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> Completed
                    </span>
                  )}
                  {reg.status === 'failed' && (
                    <span className="text-[10px] font-mono text-rose-300 font-semibold flex items-center gap-1">
                      <XCircle className="w-2.5 h-2.5 text-rose-400" /> Failed
                    </span>
                  )}
                </div>
                <div className="font-bold text-white text-sm flex items-center justify-between">
                  <span>{reg.endpoint.serverCode}</span>
                  <span className="text-xs font-normal text-slate-400">{reg.endpoint.countryCode}</span>
                </div>
                <div className="text-[11px] text-slate-400 truncate mt-0.5">{reg.endpoint.name}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Speed Gauge & Active Probe Monitor */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 flex flex-col justify-center">
          <SpeedGauge
            stage={activeStage}
            currentDownloadMbps={activeMetrics?.currentDownloadMbps ?? null}
            currentUploadMbps={activeMetrics?.currentUploadMbps ?? null}
            pingMs={activeMetrics?.pingMs ?? null}
            jitterMs={activeMetrics?.jitterMs ?? null}
            progressPercent={activeMetrics?.progressPercent ?? 0}
          />
        </div>

        <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  Active Probe Monitor
                </h3>
                <span className="text-xs font-mono text-slate-400">
                  {activeRegion ? activeRegion.endpoint.serverCode : 'Idle'}
                </span>
              </div>

              <div className="space-y-4">
                {/* Ping */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">1. Ping (Latency Probe)</span>
                    <span className="font-mono text-amber-300">
                      {activeMetrics?.pingMs !== null && activeMetrics?.pingMs !== undefined
                        ? `${activeMetrics.pingMs.toFixed(1)} ms`
                        : '--'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all duration-200"
                      style={{ width: `${activeMetrics?.pingProgress || 0}%` }}
                    />
                  </div>
                </div>

                {/* Jitter */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">2. Jitter (Packet Variation)</span>
                    <span className="font-mono text-sky-300">
                      {activeMetrics?.jitterMs !== null && activeMetrics?.jitterMs !== undefined
                        ? `${activeMetrics.jitterMs.toFixed(2)} ms`
                        : '--'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-400 transition-all duration-200"
                      style={{ width: `${activeMetrics?.jitterProgress || 0}%` }}
                    />
                  </div>
                </div>

                {/* Download */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">3. Download Stream</span>
                    <span className="font-mono text-cyan-300">
                      {activeMetrics?.currentDownloadMbps !== null && activeMetrics?.currentDownloadMbps !== undefined
                        ? `${activeMetrics.currentDownloadMbps.toFixed(2)} Mbps`
                        : '--'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 transition-all duration-200"
                      style={{ width: `${activeMetrics?.downloadProgress || 0}%` }}
                    />
                  </div>
                </div>

                {/* Upload */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">4. Upload Stream</span>
                    <span className="font-mono text-indigo-300">
                      {activeMetrics?.currentUploadMbps !== null && activeMetrics?.currentUploadMbps !== undefined
                        ? `${activeMetrics.currentUploadMbps.toFixed(2)} Mbps`
                        : '--'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 transition-all duration-200"
                      style={{ width: `${activeMetrics?.uploadProgress || 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800/80 mt-6 flex items-center justify-between text-[11px] text-slate-500">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>LibreSpeed multi-stream</span>
              </div>
              <span>Zero-simulated</span>
            </div>
          </div>
        </div>
      </section>

      {/* Speed Test History Drawer */}
      {showHistory && (
        <section className="bg-[#141e33] border border-cyan-500/40 rounded-2xl p-6 backdrop-blur-xl space-y-4 animate-fade-in shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-700 flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Recent Speed Test Sessions
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
                    await clearAllSpeedSessions();
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
              No speed test sessions logged yet. Click &quot;Start Speed Test&quot; to begin.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-80 overflow-y-auto">
              {historySessions.map((sess) => {
                const dt = formatSessionDateTime(sess.startedAt);

                return (
                  <div
                    key={sess.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-800/30 px-2 rounded-xl transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-sans font-bold text-slate-100">{dt.dateFull}</span>
                        <span className="font-mono font-bold text-cyan-300 text-xs bg-slate-900/90 px-2 py-0.5 rounded border border-cyan-500/40 tracking-wider shadow-inner">
                          {dt.timeWithSeconds}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">({dt.relative})</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 mt-1 block">
                        ID: {sess.id} • 4 Regional Nodes Sequenced
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-3 font-mono text-xs">
                        <span className="text-emerald-400 font-semibold" title="Completed regions">
                          ✓ {sess.summary?.completedRegions ?? 0}
                        </span>
                        {(sess.summary?.failedRegions ?? 0) > 0 && (
                          <span className="text-rose-400 font-semibold" title="Failed regions">
                            ✕ {sess.summary.failedRegions}
                          </span>
                        )}
                        <span className="text-cyan-300 font-bold">
                          DL: {sess.summary?.avgDownloadMbps ? `${sess.summary.avgDownloadMbps.toFixed(1)}M` : '—'}
                        </span>
                        <span className="text-blue-300 font-bold">
                          UL: {sess.summary?.avgUploadMbps ? `${sess.summary.avgUploadMbps.toFixed(1)}M` : '—'}
                        </span>
                        <span className="text-yellow-300-bold">
                          Ping: {sess.summary?.avgPingMs ? `${sess.summary.avgPingMs.toFixed(0)}ms` : '—'}
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
                          const updated = await removeSpeedSession(sess.id);
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

      {/* Completion Banner */}
      {hasCompletedRun && !isSequenceRunning && (
        <section className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 border border-cyan-500/30 shadow-2xl animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Speed Test Complete across 4 Regions
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    4 of 4 Processed
                  </span>
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  All four regional LibreSpeed endpoints have been benchmarked.
                </p>
                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs font-mono">
                  <span className="text-emerald-400">
                    ✓ Completed: <strong>{completedCount}</strong>
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-rose-400">
                    ✕ Blocked / Failed: <strong>{failedCount}</strong>
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleStartSequentialTest}
              type="button"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20 transition-all cursor-pointer self-start sm:self-auto hover:scale-105"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Run Sequence Again
            </button>
          </div>
        </section>
      )}

      {/* 2x2 Grid of Regional Result Sections */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
              Regional Speed Results (2×2 Grid)
            </h2>
            <p className="text-xs text-slate-400">
              Dedicated benchmarks for IN-DC01, IN-DC02, LK-DC01, and SG-DC01.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {completedCount} Done • {failedCount} Failed • {waitingCount} Waiting
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {regionStates.map((region, index) => (
            <RegionResultSection
              key={region.endpoint.id}
              region={region}
              index={index}
              isActive={activeRegionIndex === index}
            />
          ))}
        </div>
      </section>

      {/* Speed Test Session Details Modal */}
      <SpeedSessionDetailModal
        session={selectedDetailSession}
        onClose={() => setSelectedDetailSession(null)}
      />
    </div>
  );
};
