import React, { useState } from 'react';
import { UNIFIED_ENDPOINTS, UnifiedEndpoint } from '../config/endpoints';
import { testRegionalEndpointConnection } from '../services/regionalApi';
import {
  Server,
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

export const EndpointsPage: React.FC = () => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; latencyMs: number; message: string }>>({});

  const handleTestEndpoint = async (endpoint: UnifiedEndpoint) => {
    setTestingId(endpoint.serverCode);
    try {
      const res = await testRegionalEndpointConnection(endpoint.serverCode);
      setTestResults((prev) => ({
        ...prev,
        [endpoint.serverCode]: {
          ok: res.ok,
          latencyMs: res.latencyMs,
          message: res.message,
        },
      }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [endpoint.serverCode]: {
          ok: false,
          latencyMs: 0,
          message: err.message || 'Connection failed',
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Header */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-6 sm:p-7 backdrop-blur-xl shadow-xl">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
            Regional Topology &amp; Diagnostics
          </span>
          <span className="text-slate-500">•</span>
          <span className="text-xs text-slate-300 font-medium">Infrastructure Specifications</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
          Authorized Data Center Endpoints
        </h1>
        <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl font-normal leading-relaxed">
          Unified specifications and endpoint URLs for both the LibreSpeed benchmarking service (Port 8443) and
          ICMP latency probes to 8.8.8.8.
        </p>
      </div>

      {/* 4 Endpoints Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {UNIFIED_ENDPOINTS.map((endpoint) => {
          const test = testResults[endpoint.serverCode];
          const isTesting = testingId === endpoint.serverCode;

          const codeBadge =
            endpoint.countryCode === 'IN'
              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
              : endpoint.countryCode === 'SL'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
              : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40';

          return (
            <div
              key={endpoint.id}
              className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-6 backdrop-blur-xl shadow-xl flex flex-col justify-between hover:border-slate-600 transition-all"
            >
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-700/80 mb-4">
                  <div className="flex items-center gap-3">
                    {/* Country Code Badge: IN, IN, SL, SG */}
                    <span className={`w-9 h-9 rounded-xl border font-mono font-black text-sm flex items-center justify-center select-none ${codeBadge}`}>
                      {endpoint.countryCode}
                    </span>
                    <div>
                      <h3 className="font-extrabold text-white text-base">
                        {endpoint.serverCode} — {endpoint.name}
                      </h3>
                      <p className="text-xs font-semibold text-cyan-300">{endpoint.fullName}</p>
                    </div>
                  </div>

                  <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700">
                    {endpoint.countryCode} Node
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-[#0c1424] border border-slate-700/80 space-y-1">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      Provider &amp; Infrastructure Tier
                    </div>
                    <div className="text-white font-semibold">{endpoint.provider}</div>
                    <div className="text-[11px] font-mono text-cyan-300">
                      Coordinates: {endpoint.coordinates} • {endpoint.location}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0c1424] border border-slate-700/80 space-y-1">
                    <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider flex items-center justify-between">
                      <span>LibreSpeed Speed Test Endpoint</span>
                      <span className="font-mono text-slate-400 font-semibold">Port 8443</span>
                    </div>
                    <div className="font-mono text-xs text-white truncate font-bold">{endpoint.baseUrl}</div>
                    <div className="text-[11px] text-slate-300 font-mono flex flex-wrap gap-x-3 gap-y-1 pt-1 font-medium">
                      <span>DL: /garbage.php</span>
                      <span>UL: /empty.php</span>
                      <span>Ping: /empty.php</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0c1424] border border-slate-700/80 space-y-1">
                    <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                      ICMP Ping Target
                    </div>
                    <div className="font-mono text-xs text-white font-bold">8.8.8.8 (Google DNS)</div>
                    <div className="text-[11px] text-slate-300 font-medium">
                      Dispatched via regional daemon / outbound push agent
                    </div>
                  </div>
                </div>

                {test && (
                  <div
                    className={`mt-4 p-3 rounded-xl border text-xs flex items-center gap-2 font-medium ${
                      test.ok
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {test.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span className="truncate">{test.message}</span>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-slate-700/80 flex items-center justify-between">
                <div className="text-[11px] text-slate-300 flex items-center gap-1 font-mono font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Verified Infrastructure</span>
                </div>

                <button
                  onClick={() => handleTestEndpoint(endpoint)}
                  disabled={isTesting}
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition-colors cursor-pointer disabled:opacity-50 border border-slate-600"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Testing...' : 'Probe Node'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
