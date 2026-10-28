import React from 'react';
import { type PingSession, REGIONS, COUNTRY_CODES } from '../types/ping';
import { StatusBadge } from './StatusBadge';
import {
  X,
  History,
  Calendar,
  Radio,
  Server,
  Layers,
} from 'lucide-react';

interface SessionDetailModalProps {
  session: PingSession | null;
  onClose: () => void;
}

export const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  session,
  onClose,
}) => {
  if (!session) return null;

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const getSessionBadgeStatus = (status: string) => {
    switch (status) {
      case 'success':
        return 'Success';
      case 'partial_loss':
        return 'Partial Loss';
      case 'failed':
        return 'Failed';
      case 'running':
        return 'Running';
      default:
        return 'Not Tested';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in">
      <div className="bg-[#141e33] border border-slate-700 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#0f172a] border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-white text-base">
                  Test Session Details
                </h3>
              </div>
              <p className="text-xs text-slate-300 font-mono mt-0.5">
                Session ID: {session.id}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StatusBadge status={getSessionBadgeStatus(session.status)} />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Overview Bar */}
        <div className="p-4 bg-[#0c1424] border-b border-slate-700/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-slate-400 flex items-center gap-1 font-semibold">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" /> Started:
            </span>
            <span className="text-white font-mono font-bold mt-1 block">
              {formatDate(session.startedAt)}
            </span>
          </div>

          <div>
            <span className="text-slate-400 flex items-center gap-1 font-semibold">
              <Radio className="w-3.5 h-3.5 text-cyan-400" /> Target IP:
            </span>
            <span className="text-white font-mono font-bold mt-1 block">
              {session.targetIp} ({session.pingCount} pkts)
            </span>
          </div>

          <div>
            <span className="text-slate-400 flex items-center gap-1 font-semibold">
              <Layers className="w-3.5 h-3.5 text-cyan-400" /> Regions Tested:
            </span>
            <span className="text-white font-mono font-bold mt-1 block">
              {session.summary?.totalRegions || 4} Regional DCs
            </span>
          </div>

          <div>
            <span className="text-slate-400 flex items-center gap-1 font-semibold">
              <Server className="w-3.5 h-3.5 text-cyan-400" /> Overall Avg:
            </span>
            <span className="text-cyan-300 font-mono font-bold mt-1 block">
              {session.summary?.overallAvgLatencyMs !== null
                ? `${session.summary?.overallAvgLatencyMs} ms`
                : '—'}
            </span>
          </div>
        </div>

        {/* Regional Breakdown Grid */}
        <div className="p-5 overflow-y-auto space-y-4 bg-[#141e33]">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Regional Data Center Results
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.values(session.regions || {}).map((res) => {
              const meta = REGIONS[res.regionId];
              const code = COUNTRY_CODES[res.regionId] || 'IN';
              const codeColor =
                code === 'IN'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
                  : code === 'SL'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                  : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40';

              return (
                <div
                  key={res.regionId}
                  className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-4 space-y-3 shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {/* IN, SL, SG code badge */}
                        <span
                          className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 font-mono font-black text-[11px] select-none ${codeColor}`}
                        >
                          {code}
                        </span>
                        <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-800 text-white border border-slate-700">
                          {res.regionId}
                        </span>
                        <span className="font-bold text-white text-sm">
                          {meta ? meta.fullName : res.regionName}
                        </span>
                      </div>
                      <span className="text-xs text-slate-300 block mt-1">{meta?.provider}</span>
                    </div>
                    <StatusBadge status={res.status} size="sm" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-[#080d1a] border border-slate-800 font-mono text-center text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">Min</div>
                      <div className="text-white font-bold mt-0.5">
                        {res.minLatencyMs !== null ? `${res.minLatencyMs}ms` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-cyan-300 uppercase font-sans font-bold">Avg</div>
                      <div className="text-cyan-300 font-extrabold mt-0.5">
                        {res.avgLatencyMs !== null ? `${res.avgLatencyMs}ms` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-sans font-semibold">Max</div>
                      <div className="text-white font-bold mt-0.5">
                        {res.maxLatencyMs !== null ? `${res.maxLatencyMs}ms` : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs font-mono text-slate-300 pt-1">
                    <span>
                      Replies:{' '}
                      <strong className="text-emerald-400">
                        {res.successfulReplies !== null ? res.successfulReplies : '—'}
                      </strong>{' '}
                      / {res.requestsSent !== null ? res.requestsSent : '—'}
                    </span>
                    <span>
                      Loss:{' '}
                      <strong
                        className={
                          res.packetLossPercent !== null && res.packetLossPercent > 0
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }
                      >
                        {res.packetLossPercent !== null ? `${res.packetLossPercent}%` : '—'}
                      </strong>
                    </span>
                    <span>Jitter: {res.jitterMs !== null ? `${res.jitterMs}ms` : '—'}</span>
                  </div>

                  {res.errorDetails && (
                    <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs font-mono">
                      {res.errorDetails}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#0f172a] border-t border-slate-700/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer border border-slate-600"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
