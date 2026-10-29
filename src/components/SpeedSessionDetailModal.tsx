import React from 'react';
import { type SpeedTestSession } from '../types/speedSession';
import { formatSessionDateTime } from '../services/speedHistoryStorage';
import {
  X,
  History,
  Calendar,
  Gauge,
  ArrowDown,
  ArrowUp,
  Activity,
  Server,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface SpeedSessionDetailModalProps {
  session: SpeedTestSession | null;
  onClose: () => void;
}

export const SpeedSessionDetailModal: React.FC<SpeedSessionDetailModalProps> = ({
  session,
  onClose,
}) => {
  if (!session) return null;

  const dt = formatSessionDateTime(session.startedAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-fade-in">
      <div className="bg-[#141e33] border border-slate-700 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#0f172a] border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-white text-base">
                  Speed Test Session Details
                </h3>
              </div>
              <p className="text-xs text-slate-300 font-mono mt-0.5">
                Session ID: {session.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
          {/* Timestamp & Meta Banner */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Calendar className="w-4 h-4 text-cyan-400" />
              <div>
                <span className="text-xs text-slate-400 block font-medium">Test Executed</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-bold text-white text-sm">{dt.dateFull}</span>
                  <span className="font-mono font-bold text-cyan-300 text-xs bg-slate-950 px-2 py-0.5 rounded border border-cyan-500/40 tracking-wider">
                    {dt.timeWithSeconds}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">({dt.relative})</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto font-mono text-xs">
              <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {session.summary.completedRegions} Completed
              </span>
              {session.summary.failedRegions > 0 && (
                <span className="px-2.5 py-1 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-400 font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {session.summary.failedRegions} Failed
                </span>
              )}
            </div>
          </div>

          {/* Aggregate KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#0b1329] border border-cyan-500/30 rounded-xl p-3.5">
              <span className="text-[11px] font-mono text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <ArrowDown className="w-3 h-3" /> Avg Download
              </span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-black text-white">
                  {session.summary.avgDownloadMbps > 0 ? session.summary.avgDownloadMbps.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-slate-400 font-mono">Mbps</span>
              </div>
            </div>

            <div className="bg-[#0b1329] border border-blue-500/30 rounded-xl p-3.5">
              <span className="text-[11px] font-mono text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <ArrowUp className="w-3 h-3" /> Avg Upload
              </span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-black text-white">
                  {session.summary.avgUploadMbps > 0 ? session.summary.avgUploadMbps.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-slate-400 font-mono">Mbps</span>
              </div>
            </div>

            <div className="bg-[#0b1329] border border-indigo-500/30 rounded-xl p-3.5">
              <span className="text-[11px] font-mono text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Activity className="w-3 h-3" /> Avg Ping
              </span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-black text-white">
                  {session.summary.avgPingMs > 0 ? session.summary.avgPingMs.toFixed(0) : '—'}
                </span>
                <span className="text-xs text-slate-400 font-mono">ms</span>
              </div>
            </div>

            <div className="bg-[#0b1329] border border-emerald-500/30 rounded-xl p-3.5">
              <span className="text-[11px] font-mono text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <Gauge className="w-3 h-3" /> Peak Download
              </span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl sm:text-2xl font-black text-white">
                  {session.summary.peakDownloadMbps > 0 ? session.summary.peakDownloadMbps.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-slate-400 font-mono">Mbps</span>
              </div>
            </div>
          </div>

          {/* Regional Data Center Nodes Breakdown */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              Regional Data Center Nodes Breakdown
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(session.regions || {}).map(([code, reg]) => {
                const isCompleted = reg.status === 'completed';

                return (
                  <div
                    key={code}
                    className={`p-4 rounded-xl border ${
                      isCompleted
                        ? 'bg-slate-900/80 border-slate-700/80'
                        : 'bg-slate-950/80 border-rose-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                      <div>
                        <span className="text-xs font-mono font-black text-cyan-400 bg-slate-950 px-2 py-0.5 rounded border border-cyan-500/30">
                          {code}
                        </span>
                        <h5 className="font-bold text-white text-sm mt-1">{reg.name}</h5>
                        <span className="text-[11px] text-slate-400 block">{reg.country}</span>
                      </div>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                          isCompleted
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                            : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                        }`}
                      >
                        {isCompleted ? '✓ Completed' : '✕ Failed'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono mt-2">
                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-slate-400 block">Download</span>
                        <span className="font-black text-cyan-300 text-sm">
                          {reg.downloadMbps !== null ? `${reg.downloadMbps.toFixed(1)} Mbps` : '—'}
                        </span>
                      </div>

                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-slate-400 block">Upload</span>
                        <span className="font-black text-blue-300 text-sm">
                          {reg.uploadMbps !== null ? `${reg.uploadMbps.toFixed(1)} Mbps` : '—'}
                        </span>
                      </div>

                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-slate-400 block">Ping Latency</span>
                        <span className="font-black text-slate-200 text-sm">
                          {reg.pingMs !== null ? `${reg.pingMs.toFixed(0)} ms` : '—'}
                        </span>
                      </div>

                      <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-slate-400 block">Jitter</span>
                        <span className="font-black text-slate-200 text-sm">
                          {reg.jitterMs !== null ? `${reg.jitterMs.toFixed(0)} ms` : '—'}
                        </span>
                      </div>
                    </div>

                    {reg.errorMessage && (
                      <p className="text-[11px] text-rose-400 mt-2 font-mono">
                        Error: {reg.errorMessage}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#0f172a] border-t border-slate-700/80 flex items-center justify-end">
          <button
            onClick={onClose}
            type="button"
            className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-600 transition-colors cursor-pointer"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
