import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';

interface PingMonitorPageProps {
  onTestRunningChange?: (running: boolean) => void;
}

export const PingMonitorPage: React.FC<PingMonitorPageProps> = ({ onTestRunningChange }) => {
  const [regionalResults, setRegionalResults] = useState<Record<RegionId, RegionPingResult>>(() =>
    createInitialRegionalResults('8.8.8.8')
  );
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [singleRunningId, setSingleRunningId] = useState<RegionId | null>(null);
  const [lastSessionTime, setLastSessionTime] = useState<string | null>(null);
  const [targetIp, setTargetIp] = useState('8.8.8.8');
  const [pingCount, setPingCount] = useState(30);

  // Modals
  const [inspectModalResult, setInspectModalResult] = useState<RegionPingResult | null>(null);
  const [historySessions, setHistorySessions] = useState<PingSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const isRunning = isRunningAll || singleRunningId !== null;

  useEffect(() => {
    onTestRunningChange?.(isRunning);
  }, [isRunning, onTestRunningChange]);

  const handleRunAll = async () => {
    if (isRunning) return;

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
      setHistorySessions((prev) => [session, ...prev.slice(0, 19)]);
    } catch (err: any) {
      console.error('Ping session error:', err);
    } finally {
      setIsRunningAll(false);
    }
  };

  const handleRunSingle = async (regionId: string) => {
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
            Concurrent round-trip latency and packet loss benchmarking to Google DNS (8.8.8.8) dispatched across <br></br> 
            <strong className="text-cyan-300"> IN-DC01</strong>, <strong className="text-blue-300">IN-DC02</strong>, <strong className="text-emerald-300">LK-DC01</strong>, and <strong className="text-indigo-300">SG-DC01</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => setShowHistory(!showHistory)}
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
                Target: 8.8.8.8 (Google DNS) • 30 Packets
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {isRunningAll
                ? 'Dispatching ICMP Probes across 4 Regions...'
                : singleRunningId
                ? `Testing ${singleRunningId}...`
                : 'Execute Multi-Region Latency Benchmark'}
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
                  <span>Probing All Regions...</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-white" />
                  <span>Run Ping (All 4 Regions)</span>
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

      {/* History Drawer (if open) */}
      {showHistory && (
        <section className="bg-[#141e33] border border-indigo-500/40 rounded-2xl p-6 backdrop-blur-xl space-y-4 animate-fade-in shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Recent Ping Test Sessions
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              {historySessions.length} sessions logged
            </span>
          </div>

          {historySessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 font-mono">
              No sessions logged in memory yet. Click &quot;Run Ping (All 4 Regions)&quot; to begin.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
              {historySessions.map((sess) => (
                <div key={sess.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-bold text-white">{sess.id}</span>
                    <span className="text-slate-500 ml-2">
                      {new Date(sess.startedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-emerald-400">
                      ✓ {sess.summary.successfulRegions ?? 0}
                    </span>
                    <span className="text-rose-400">
                      ✕ {sess.summary.failedOrUnavailableRegions ?? 0}
                    </span>
                    <span className="text-cyan-400">
                      Avg: {sess.summary.overallAvgLatencyMs ? `${sess.summary.overallAvgLatencyMs}ms` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 4 Regional Ping Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
              Regional ICMP Telemetry
            </h2>
            <p className="text-xs text-slate-400">
              Live round-trip metrics to 8.8.8.8. Click &quot;Packets&quot; to inspect individual sequences.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            4 Nodes Active
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as RegionId[]).map((rid) => (
            <RegionCard
              key={rid}
              result={regionalResults[rid]}
              totalPlannedCount={pingCount}
              onInspectPackets={(res) => setInspectModalResult(res)}
              onRunSingle={handleRunSingle}
              isRunning={singleRunningId === rid}
            />
          ))}
        </div>
      </section>

      {/* Packet Inspection Modal */}
      <PacketInspectionModal
        onClose={() => setInspectModalResult(null)}
        result={inspectModalResult}
      />
    </div>
  );
};
