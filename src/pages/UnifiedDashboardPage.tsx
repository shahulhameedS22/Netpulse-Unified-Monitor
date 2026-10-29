import React, { useState, useEffect } from 'react';
import { UNIFIED_ENDPOINTS } from '../config/endpoints';
import { testRegionalEndpointConnection } from '../services/regionalApi';
import {
  Gauge,
  Radio,
  Activity,
  ArrowRight,
  ShieldCheck,
  Server,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Zap,
  Globe2,
} from 'lucide-react';
import { NavTab } from '../components/Navigation';

interface UnifiedDashboardPageProps {
  onSelectTab: (tab: NavTab) => void;
  speedTestRunning: boolean;
  pingTestRunning: boolean;
}

interface NodeHealth {
  serverCode: string;
  status: 'online' | 'error' | 'testing';
  latencyMs: number | null;
  message: string;
}

export const UnifiedDashboardPage: React.FC<UnifiedDashboardPageProps> = ({
  onSelectTab,
  speedTestRunning,
  pingTestRunning,
}) => {
  const [nodeHealths, setNodeHealths] = useState<Record<string, NodeHealth>>(() =>
    UNIFIED_ENDPOINTS.reduce((acc, ep) => {
      acc[ep.serverCode] = {
        serverCode: ep.serverCode,
        status: 'testing',
        latencyMs: null,
        message: 'Checking status...',
      };
      return acc;
    }, {} as Record<string, NodeHealth>)
  );
  const [refreshing, setRefreshing] = useState(false);

  const checkHealth = async () => {
    setRefreshing(true);
    const updates: Record<string, NodeHealth> = {};

    await Promise.all(
      UNIFIED_ENDPOINTS.map(async (ep) => {
        try {
          const res = await testRegionalEndpointConnection(ep.serverCode);
          updates[ep.serverCode] = {
            serverCode: ep.serverCode,
            status: res.ok ? 'online' : 'error',
            latencyMs: res.latencyMs,
            message: res.message,
          };
        } catch (err: any) {
          updates[ep.serverCode] = {
            serverCode: ep.serverCode,
            status: 'error',
            latencyMs: null,
            message: err.message || 'Connection failed',
          };
        }
      })
    );

    setNodeHealths((prev) => ({ ...prev, ...updates }));
    setRefreshing(false);
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Hero Welcome Banner */}
      <div className="relative bg-gradient-to-r from-[#141e33] via-[#16233f] to-[#122b44] border border-slate-700/80 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
                <Activity className="w-3.5 h-3.5" />
                Network Operations Center
              </span>
              <span className="text-slate-500"></span>
              <span className="text-xs font-mono font-semibold text-slate-300"></span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Unified Infrastructure Monitoring
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
              Consolidated real-time benchmarking platform connecting regional data centers in India, Sri Lanka, and Singapore.
              Run high-throughput LibreSpeed speed tests and continuous ICMP latency monitoring from a single interface.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={checkHealth}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-600 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Probe Node Health</span>
            </button>
          </div>
        </div>
      </div>

      {/* Two Core Applications Quick Launch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* App 1: Network Speed Test */}
        <div className="group bg-[#141e33] border border-slate-700/80 hover:border-cyan-500/50 rounded-2xl p-6 sm:p-7 backdrop-blur-xl transition-all duration-200 flex flex-col justify-between shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-500/15 transition-colors" />

          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 flex items-center justify-center shadow-lg shadow-cyan-500/10">
                <Gauge className="w-6 h-6 stroke-[2.2]" />
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${
                speedTestRunning
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 animate-pulse'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}>
                <Activity className="w-3 h-3 text-cyan-400" />
                {speedTestRunning ? 'Test In Progress' : 'Ready to Run'}
              </span>
            </div>

            <h2 className="text-xl font-black text-white tracking-tight mb-2">
              Network Speed Test
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-6 font-normal">
              Official LibreSpeed client engine executing sequential multi-stream speed tests across all four
              data center servers (IN-DC01, IN-DC02, LK-DC01, SG-DC01). Measures download, upload, ping, and RFC 3550 jitter.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6 font-mono text-xs">
              <div className="p-3 rounded-xl bg-[#0c1424] border border-slate-700/70">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold font-sans">Target Metric</span>
                <span className="text-cyan-300 font-bold">Download &amp; Upload</span>
              </div>
              <div className="p-3 rounded-xl bg-[#0c1424] border border-slate-700/70">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold font-sans">Engine Protocol</span>
                <span className="text-cyan-300 font-bold">LibreSpeed Worker</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectTab('speedtest')}
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-extrabold text-sm bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/25 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            <span>Launch Speed Test App</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* App 2: Ping Monitoring */}
        <div className="group bg-[#141e33] border border-slate-700/80 hover:border-indigo-500/50 rounded-2xl p-6 sm:p-7 backdrop-blur-xl transition-all duration-200 flex flex-col justify-between shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-indigo-500/15 transition-colors" />

          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 text-indigo-300 flex items-center justify-center shadow-lg shadow-indigo-500/10">
                <Radio className="w-6 h-6 stroke-[2.2]" />
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${
                pingTestRunning
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/40 animate-pulse'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}>
                <Activity className="w-3 h-3 text-indigo-400" />
                {pingTestRunning ? 'Probing Latency' : 'Ready to Run'}
              </span>
            </div>

            <h2 className="text-xl font-black text-white tracking-tight mb-2">
              Ping Monitoring
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-6 font-normal">
              Real ICMP probe telemetry dispatched against Google DNS (8.8.8.8) across IN-DC01, IN-DC02, LK-DC01, and SG-DC01.
              Inspect 30 individual packets, packet loss, min/avg/max latency, and automated timeout alerts.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6 font-mono text-xs">
              <div className="p-3 rounded-xl bg-[#0c1424] border border-slate-700/70">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold font-sans">Target Endpoint</span>
                <span className="text-indigo-300 font-bold">8.8.8.8 (Google DNS)</span>
              </div>
              <div className="p-3 rounded-xl bg-[#0c1424] border border-slate-700/70">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold font-sans">Sample Count</span>
                <span className="text-indigo-300 font-bold">30 Packets / Probe</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectTab('ping')}
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-extrabold text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            <span>Launch Ping Monitoring App</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Regional Infrastructure Nodes Status */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-6 backdrop-blur-xl shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-700/80 mb-6">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-lg font-black text-white">Regional Data Center Nodes</h2>
              <p className="text-xs text-slate-300">Real connectivity status across the 4 authorized deployment locations</p>
            </div>
          </div>
          <button
            onClick={() => onSelectTab('endpoints')}
            className="text-xs text-cyan-300 hover:text-cyan-200 font-bold transition-colors cursor-pointer"
          >
            Inspect Topology →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {UNIFIED_ENDPOINTS.map((endpoint) => {
            const health = nodeHealths[endpoint.serverCode];
            const codeBadge =
              endpoint.countryCode === 'IN'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
                : endpoint.countryCode === 'SL'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40';

            return (
              <div
                key={endpoint.id}
                className="p-4 rounded-xl bg-[#0c1424] border border-slate-700/80 hover:border-slate-600 transition-all shadow-md"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {/* Country Code Badge: IN, IN, SL, SG */}
                    <span className={`w-7 h-7 rounded-lg border font-mono font-black text-xs flex items-center justify-center select-none ${codeBadge}`}>
                      {endpoint.countryCode}
                    </span>
                    <span className="font-extrabold text-white text-sm">{endpoint.serverCode}</span>
                  </div>
                  {health?.status === 'online' ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {health.latencyMs}ms
                    </span>
                  ) : health?.status === 'testing' ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-300 bg-cyan-500/15 px-2 py-0.5 rounded-full border border-cyan-500/30 animate-pulse">
                      Checking
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
                      Standby
                    </span>
                  )}
                </div>

                <div className="text-xs font-bold text-slate-100 truncate mt-1">{endpoint.fullName}</div>
                <div className="text-[11px] text-slate-300 mt-0.5 truncate">{endpoint.provider}</div>
                <div className="text-[10px] font-mono text-cyan-400 mt-2 pt-2 border-t border-slate-800 truncate font-semibold">
                  Port 8443 / ICMP Telemetry
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
