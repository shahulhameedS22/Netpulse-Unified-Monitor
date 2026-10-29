import React from 'react';
import {
  type RegionPingResult,
  type RegionId,
  COUNTRY_CODES,
} from '../types/ping';
import { UNIFIED_ENDPOINTS } from '../config/endpoints';
import { StatusBadge } from './StatusBadge';
import {
  Clock,
  Server,
  Loader2,
  AlertCircle,
  Play,
  ListFilter,
  CheckCircle2,
  Activity,
} from 'lucide-react';

interface RegionCardProps {
  result: RegionPingResult;
  totalPlannedCount: number;
  onInspectPackets?: (result: RegionPingResult) => void;
  onRunSingle?: (regionId: string) => void;
  isRunning?: boolean;
}

export const RegionCard: React.FC<RegionCardProps> = ({
  result,
  totalPlannedCount,
  onInspectPackets,
  onRunSingle,
  isRunning = false,
}) => {
  const meta = UNIFIED_ENDPOINTS.find((e) => e.serverCode === result.regionId) || {
    serverCode: result.regionId,
    name: result.regionId,
    fullName: result.regionName,
    location: 'Tier III Facility',
    country: 'Global',
    countryCode: (COUNTRY_CODES[result.regionId as RegionId] || 'IN') as 'IN' | 'SL' | 'SG',
    flagUrl: '',
    accentColor: '#06B6D4',
    provider: 'Regional Data Center',
  };

  const isTesting = result.status === 'Running' || isRunning;
  const hasResults = result.requestsSent !== null && result.requestsSent > 0;

  const formatLatency = (val: number | null) => {
    return val !== null ? `${val.toFixed(1)} ms` : '—';
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `~ ${ms} ms`;
    return `~ ${(ms / 1000).toFixed(2)} s`;
  };

  // Distinct country code badges with vibrant, attractive styling: IN, IN, SL, SG
  const getCountryBadgeStyle = (code: 'IN' | 'SL' | 'SG', serverCode: string) => {
    switch (serverCode) {
      case 'IN-DC01':
        return {
          code: 'IN',
          badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40 shadow-sm shadow-cyan-500/20',
          indicatorClass: 'bg-cyan-400',
          accentBorder: 'border-t-2 border-t-cyan-400',
        };
      case 'IN-DC02':
        return {
          code: 'IN',
          badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-400/40 shadow-sm shadow-blue-500/20',
          indicatorClass: 'bg-blue-400',
          accentBorder: 'border-t-2 border-t-blue-400',
        };
      case 'LK-DC01':
        return {
          code: 'SL',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 shadow-sm shadow-emerald-500/20',
          indicatorClass: 'bg-emerald-400',
          accentBorder: 'border-t-2 border-t-emerald-400',
        };
      case 'SG-DC01':
        return {
          code: 'SG',
          badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40 shadow-sm shadow-indigo-500/20',
          indicatorClass: 'bg-indigo-400',
          accentBorder: 'border-t-2 border-t-indigo-400',
        };
      default:
        return {
          code,
          badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40',
          indicatorClass: 'bg-cyan-400',
          accentBorder: 'border-t-2 border-t-cyan-400',
        };
    }
  };

  const badgeConfig = getCountryBadgeStyle(meta.countryCode, result.regionId);

  const REGIONAL_DC_NAMES: Record<string, string> = {
    'IN-DC01': 'TATA data center',
    'IN-DC02': 'ACT data center',
    'LK-DC01': 'Srilanka data center',
    'SG-DC01': 'Singapore data center',
  };

  const deliveryPercent =
    hasResults && result.requestsSent && result.requestsSent > 0
      ? Math.max(0, Math.min(100, Math.round(((result.successfulReplies ?? 0) / result.requestsSent) * 100)))
      : 0;

  return (
    <div
      className={`bg-[#141e33] hover:bg-[#18243c] rounded-2xl border border-slate-700/80 shadow-xl flex flex-col justify-between overflow-hidden transition-all duration-200 hover:border-slate-600 hover:shadow-cyan-900/10 ${badgeConfig.accentBorder}`}
    >
      <div className="p-5">
        {/* Header: Country code badge (IN, IN, SL, SG) and Regional DC Identity */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Custom high-visibility country code badge: IN, IN, SL, SG */}
            <div
              className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center shrink-0 border font-mono font-black text-sm tracking-wider select-none ${badgeConfig.badgeClass}`}
            >
              <span>{badgeConfig.code}</span>
              <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${badgeConfig.indicatorClass}`} />
            </div>

            <div className="min-w-0">
              <h3 className="font-black text-white text-lg tracking-tight leading-tight whitespace-nowrap">
                {result.regionId}
              </h3>
              <div className="text-xs text-cyan-300 font-semibold leading-tight mt-1">
                {REGIONAL_DC_NAMES[result.regionId] || meta.fullName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            {isTesting && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
            <StatusBadge status={result.status} size="sm" />
          </div>
        </div>

        {/* Target IP and Packet Count Row */}
        <div className="mt-4 pt-3 border-t border-slate-700/70 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-1.5 text-slate-200">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-300 font-sans font-medium">Target:</span>
            <span className="font-bold text-white bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700 text-[11px]">
              {result.targetIp || '8.8.8.8'}
            </span>
          </div>
          <div className="flex items-center gap-1 text-slate-200">
            <span className="text-slate-300 font-sans font-medium">Count:</span>
            <span className="font-bold text-white font-mono">{totalPlannedCount || 30} pkts</span>
          </div>
        </div>

        {/* Ping Statistics Grid */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-700/60">
          <div className="p-2.5 rounded-xl bg-[#0c1424] border border-slate-700/70">
            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Replies</div>
            <div
              className={`text-base font-extrabold font-mono mt-0.5 ${
                result.successfulReplies !== null ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {result.successfulReplies !== null ? result.successfulReplies : '—'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0c1424] border border-slate-700/70">
            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Loss</div>
            <div
              className={`text-base font-extrabold font-mono mt-0.5 ${
                result.failedRequests !== null && result.failedRequests > 0
                  ? 'text-rose-400'
                  : result.failedRequests === 0
                  ? 'text-emerald-400'
                  : 'text-slate-400'
              }`}
            >
              {result.failedRequests !== null ? result.failedRequests : '—'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0c1424] border border-slate-700/70">
            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Loss Rate</div>
            <div
              className={`text-base font-extrabold font-mono mt-0.5 ${
                result.packetLossPercent !== null
                  ? result.packetLossPercent > 0
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                  : 'text-slate-400'
              }`}
            >
              {result.packetLossPercent !== null ? `${result.packetLossPercent}%` : '—'}
            </div>
          </div>
        </div>

        {/* Latency Statistics Grid */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
          <div className="p-2.5 rounded-xl bg-[#0c1424] border border-slate-700/70">
            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Min</div>
            <div className="text-xs font-bold font-mono text-white mt-0.5">
              {formatLatency(result.minLatencyMs)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0c1424] border border-slate-700/70">
            <div className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">Avg</div>
            <div
              className={`text-xs font-bold font-mono mt-0.5 ${
                result.avgLatencyMs !== null ? 'text-cyan-300' : 'text-slate-400'
              }`}
            >
              {formatLatency(result.avgLatencyMs)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#0c1424] border border-slate-700/70">
            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Max</div>
            <div className="text-xs font-bold font-mono text-white mt-0.5">
              {formatLatency(result.maxLatencyMs)}
            </div>
          </div>
        </div>

        {/* Error Details if any */}
        {result.errorDetails && (
          <div
            onClick={() => onInspectPackets?.(result)}
            className="mt-3 p-2.5 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-200 flex items-start gap-2 cursor-pointer hover:bg-rose-950/60 transition-colors"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span className="font-medium leading-tight">{result.errorDetails}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-4 pt-3 border-t border-slate-700/70 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-300 text-[11px] font-mono">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold">{formatDuration(result.durationMs)}</span>
          </div>

          <div className="flex items-center gap-2">
            {hasResults && (
              <button
                onClick={() => onInspectPackets?.(result)}
                type="button"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 transition-colors cursor-pointer"
              >
                <ListFilter className="w-3.5 h-3.5 text-cyan-400" />
                <span>Packets ({result.packets?.length || 0})</span>
              </button>
            )}

            {onRunSingle && (
              <button
                onClick={() => onRunSingle(result.regionId)}
                disabled={isTesting}
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40 transition-colors cursor-pointer disabled:opacity-50 shadow-sm shadow-cyan-600/30"
              >
                {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                <span>Ping</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Delivery Progress Bar */}
      <div className="w-full bg-[#0c1424] h-1.5 overflow-hidden">
        {hasResults ? (
          <div
            className={`h-full transition-all duration-300 ${
              (result.packetLossPercent ?? 0) > 0 ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
            style={{ width: `${deliveryPercent}%` }}
          />
        ) : (
          <div className="h-full bg-slate-700/50 w-0" />
        )}
      </div>
    </div>
  );
};
