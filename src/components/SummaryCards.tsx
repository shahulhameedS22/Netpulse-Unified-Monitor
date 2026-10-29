import React from 'react';
import { type SessionSummary } from '../types/ping';
import {
  Globe,
  Check,
  AlertTriangle,
  X,
  Activity,
  Loader2,
} from 'lucide-react';

interface SummaryCardsProps {
  summary: SessionSummary | null;
  lastSessionTime?: string | null;
  isRunning: boolean;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({
  summary,
  isRunning,
}) => {
  const hasRealResults = summary !== null && (
    summary.successfulRegions !== null ||
    summary.partialLossRegions !== null ||
    summary.failedOrUnavailableRegions !== null
  );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {/* 1. Total Regions */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-lg flex items-center gap-3.5 transition-all hover:border-cyan-500/40">
        <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0">
          <Globe className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
            Total Regions
          </span>
          <span className="text-xl sm:text-2xl font-black font-mono text-white mt-0.5 block leading-none">
            {summary?.totalRegions ?? 4}
          </span>
        </div>
      </div>

      {/* 2. Successful */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-lg flex items-center justify-between gap-3 transition-all hover:border-emerald-500/40">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
            <Check className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
              Successful
            </span>
            <span className="text-xl sm:text-2xl font-black font-mono text-emerald-400 mt-0.5 block leading-none">
              {hasRealResults && summary?.successfulRegions !== null ? summary.successfulRegions : '—'}
            </span>
          </div>
        </div>
        {hasRealResults && summary?.successfulRegions !== null && (
          <span className="text-xs font-mono font-bold text-emerald-300 self-end mb-0.5 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
            {Math.round((summary.successfulRegions / 4) * 100)}%
          </span>
        )}
      </div>

      {/* 3. Partial Loss */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-lg flex items-center justify-between gap-3 transition-all hover:border-amber-500/40">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
              Partial Loss
            </span>
            <span className="text-xl sm:text-2xl font-black font-mono text-amber-400 mt-0.5 block leading-none">
              {hasRealResults && summary?.partialLossRegions !== null ? summary.partialLossRegions : '—'}
            </span>
          </div>
        </div>
        {hasRealResults && summary?.partialLossRegions !== null && (
          <span className="text-xs font-mono font-bold text-amber-300 self-end mb-0.5 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
            {Math.round((summary.partialLossRegions / 4) * 100)}%
          </span>
        )}
      </div>

      {/* 4. Failed / Down */}
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-lg flex items-center justify-between gap-3 transition-all hover:border-rose-500/40">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-rose-500/15 border border-rose-400/30 flex items-center justify-center text-rose-300 shrink-0">
            <X className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
              Failed / Down
            </span>
            <span className="text-xl sm:text-2xl font-black font-mono text-rose-400 mt-0.5 block leading-none">
              {hasRealResults && summary?.failedOrUnavailableRegions !== null ? summary.failedOrUnavailableRegions : '—'}
            </span>
          </div>
        </div>
        {hasRealResults && summary?.failedOrUnavailableRegions !== null && (
          <span className="text-xs font-mono font-bold text-rose-300 self-end mb-0.5 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
            {Math.round((summary.failedOrUnavailableRegions / 4) * 100)}%
          </span>
        )}
      </div>

      {/* 5. Average Latency */}
      <div className="col-span-2 lg:col-span-1 bg-[#141e33] border border-slate-700/80 rounded-2xl p-4 sm:p-5 shadow-lg flex items-center gap-3.5 transition-all hover:border-cyan-500/40">
        <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0">
          {isRunning ? (
            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          ) : (
            <Activity className="w-5 h-5" />
          )}
        </div>
        <div className="min-w-0">
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block truncate">
            Average Latency
          </span>
          <span className="text-xl sm:text-2xl font-black font-mono text-cyan-300 mt-0.5 block leading-none">
            {isRunning
              ? 'Probing...'
              : hasRealResults && summary?.overallAvgLatencyMs !== null
              ? `${summary.overallAvgLatencyMs} ms`
              : '—'}
          </span>
        </div>
      </div>
    </div>
  );
};
