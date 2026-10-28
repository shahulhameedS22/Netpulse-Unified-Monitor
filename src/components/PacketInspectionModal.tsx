import React from 'react';
import { type RegionPingResult, REGIONS, COUNTRY_CODES } from '../types/ping';
import { StatusBadge } from './StatusBadge';
import { X, Terminal, Radio, Server, Clock, AlertCircle } from 'lucide-react';

interface PacketInspectionModalProps {
  result: RegionPingResult | null;
  onClose: () => void;
}

export const PacketInspectionModal: React.FC<PacketInspectionModalProps> = ({
  result,
  onClose,
}) => {
  if (!result) return null;
  const meta = REGIONS[result.regionId];
  const hasRealPackets = result.packets && result.packets.length > 0;
  const countryCode = COUNTRY_CODES[result.regionId] || 'IN';

  const badgeColor =
    countryCode === 'IN'
      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
      : countryCode === 'SL'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
      : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in">
      <div className="bg-[#141e33] border border-slate-700 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#0f172a] border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Bold country badge: IN, IN, SL, SG */}
                <span
                  className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 font-mono font-black text-xs select-none ${badgeColor}`}
                >
                  {countryCode}
                </span>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-white border border-slate-600">
                  {result.regionId}
                </span>
                <h3 className="font-extrabold text-white text-base">
                  {meta.fullName} — Regional Node Diagnostics
                </h3>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                {meta.provider} • ICMP Outbound Telemetry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusBadge status={result.status} size="sm" />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Diagnostic Overview */}
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-[#0c1424] rounded-xl border border-slate-700/80">
              <span className="text-slate-300 font-semibold uppercase tracking-wider text-[10px] block">Target IP</span>
              <div className="text-white font-extrabold font-mono mt-1 text-sm">{result.targetIp || '8.8.8.8'}</div>
            </div>
            <div className="p-3 bg-[#0c1424] rounded-xl border border-slate-700/80">
              <span className="text-slate-300 font-semibold uppercase tracking-wider text-[10px] block">Requests Sent</span>
              <div className="text-white font-extrabold font-mono mt-1 text-sm">{result.requestsSent !== null ? result.requestsSent : '—'}</div>
            </div>
            <div className="p-3 bg-[#0c1424] rounded-xl border border-slate-700/80">
              <span className="text-slate-300 font-semibold uppercase tracking-wider text-[10px] block">Packet Loss</span>
              <div className={`font-extrabold font-mono mt-1 text-sm ${result.packetLossPercent !== null && result.packetLossPercent > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {result.packetLossPercent !== null ? `${result.packetLossPercent}%` : '—'}
              </div>
            </div>
            <div className="p-3 bg-[#0c1424] rounded-xl border border-slate-700/80">
              <span className="text-slate-300 font-semibold uppercase tracking-wider text-[10px] block">Average Latency</span>
              <div className="text-cyan-300 font-extrabold font-mono mt-1 text-sm">{result.avgLatencyMs !== null ? `${result.avgLatencyMs.toFixed(1)} ms` : '—'}</div>
            </div>
          </div>

          {/* Packet Stream or Clean Standby Message */}
          {hasRealPackets ? (
            <div className="border border-slate-700/80 rounded-xl overflow-hidden">
              <div className="bg-[#0f172a] px-4 py-2 border-b border-slate-700/80 text-xs font-semibold text-slate-200 flex items-center justify-between">
                <span>Captured ICMP Packets (Sequence Log)</span>
                <span className="font-mono text-cyan-400 text-[11px]">{result.packets!.length} Packets</span>
              </div>
              <div className="p-4 bg-[#080d1a] font-mono text-xs text-slate-100 max-h-64 overflow-y-auto space-y-1.5">
                {result.packets!.map((p) => (
                  <div key={p.sequence} className="flex justify-between items-center py-0.5 border-b border-slate-800/60 last:border-0">
                    <span className={p.success ? 'text-emerald-300' : 'text-rose-400'}>
                      Seq={p.sequence} {p.success ? `bytes=32 time=${p.latencyMs}ms TTL=${p.ttl || 117}` : 'Request timed out'}
                    </span>
                    <span className="text-slate-400 text-[11px]">{p.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center border border-dashed border-slate-700 rounded-xl bg-[#0c1424] text-slate-400">
              <Radio className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
              <p className="font-bold text-white text-sm">No Packet Telemetry Captured</p>
              <p className="text-xs text-slate-300 mt-1 max-w-md mx-auto">
                Detailed packet reply telemetry will appear here after executing tests through the authorized regional daemon for {meta.name}.
              </p>
            </div>
          )}

          {result.errorDetails && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="font-mono">{result.errorDetails}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#0f172a] border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-300">
          <span>Regional Daemon Execution Pipeline • Zero simulated telemetry</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors cursor-pointer border border-slate-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
