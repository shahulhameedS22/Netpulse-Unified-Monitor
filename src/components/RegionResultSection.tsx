import React from 'react';
import { TestEndpoint } from '../config/endpoints';
import { LiveMetrics, SpeedTestResult, TestStage, RegionStatus, RegionState } from '../types/speed';
import {
  ArrowDown,
  ArrowUp,
  Wifi,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';

interface RegionResultSectionProps {
  region: RegionState;
  index: number;
  isActive: boolean;
}

export const RegionResultSection: React.FC<RegionResultSectionProps> = ({
  region,
  index,
  isActive,
}) => {
  const { endpoint, status, stage, liveMetrics, result, errorMessage } = region;

  const getStageDisplay = () => {
    switch (stage) {
      case 'ping':
        return `Testing Ping (${liveMetrics?.pingProgress || 0}%)`;
      case 'jitter':
        return `Testing Jitter (${liveMetrics?.jitterProgress || 0}%)`;
      case 'download':
        return `Testing Download (${liveMetrics?.downloadProgress || 0}%)`;
      case 'upload':
        return `Testing Upload (${liveMetrics?.uploadProgress || 0}%)`;
      default:
        return 'Connecting...';
    }
  };

  const isDownloadLow = result !== null && result.downloadMbps < 25;
  const isUploadLow = result !== null && result.uploadMbps < 25;
  const isPingHigh = result !== null && result.pingMs > 110;
  const isJitterHigh = result !== null && result.jitterMs > 110;
  const hasAlerts = isDownloadLow || isUploadLow || isPingHigh || isJitterHigh;
  const alertsCount = [isDownloadLow, isUploadLow, isPingHigh, isJitterHigh].filter(Boolean).length;

  const codeBadgeColor =
    endpoint.countryCode === 'IN'
      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
      : endpoint.countryCode === 'SL'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
      : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40';

  return (
    <section
      id={`region-${endpoint.serverCode.toLowerCase()}`}
      className={`rounded-2xl transition-all duration-300 relative overflow-hidden backdrop-blur-xl border ${
        isActive
          ? 'bg-[#16233f] border-cyan-400/70 ring-2 ring-cyan-500/40 shadow-2xl shadow-cyan-900/20'
          : status === 'completed'
          ? 'bg-[#141e33] border-slate-700/80 shadow-lg'
          : status === 'failed'
          ? 'bg-[#141e33] border-rose-900/50 shadow-md'
          : 'bg-[#11192b] border-slate-700/60 opacity-95'
      } p-5`}
    >
      {/* Top Banner & Header */}
      <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-slate-700/80">
        <div className="flex items-center gap-3 min-w-0">
          {/* Country Code Badge: IN, IN, SL, SG */}
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-black text-xs shrink-0 border select-none ${codeBadgeColor}`}
          >
            {endpoint.countryCode}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap leading-tight">
              <h3 className="text-base font-black text-white tracking-tight">
                {endpoint.serverCode}
              </h3>
              <span className="text-slate-500 text-xs">•</span>
              <span className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                {endpoint.name}
              </span>
              <span className="text-[10px] font-mono font-bold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
                {endpoint.countryCode} Node
              </span>
            </div>
            <div className="text-xs text-slate-300 font-medium truncate max-w-[240px] sm:max-w-xs mt-0.5">
              <span>{endpoint.provider}</span>
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {status === 'waiting' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Waiting
            </span>
          )}

          {status === 'testing' && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 animate-pulse shadow-sm shadow-cyan-500/20">
              <Activity className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
              {getStageDisplay()}
            </span>
          )}

          {status === 'completed' && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Completed
              </span>
              {hasAlerts && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/40">
                  <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                  {alertsCount} Alert{alertsCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {status === 'failed' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-400/40">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              Failed
            </span>
          )}
        </div>
      </div>

      {/* In-Test Progress Bar */}
      {status === 'testing' && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-cyan-300 font-semibold flex items-center gap-1">
              <Activity className="w-3 h-3 text-cyan-400 animate-pulse" />
              {getStageDisplay()}
            </span>
            <span className="font-mono text-cyan-300 font-bold">
              {liveMetrics?.progressPercent || 0}%
            </span>
          </div>
          <div className="w-full bg-[#0c1424] h-2 rounded-full overflow-hidden border border-slate-700/60">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 transition-all duration-200"
              style={{ width: `${liveMetrics?.progressPercent || 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Failure Banner if Region Failed */}
      {status === 'failed' && (
        <div className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs leading-tight font-medium">
              <span className="font-bold text-rose-300">
                Connection to {endpoint.serverCode} blocked:{' '}
              </span>
              <span>
                {errorMessage || 'Direct browser connection blocked or TLS connection refused on port 8443.'}
              </span>
            </div>
          </div>
          <div className="px-2.5 py-1 rounded bg-[#0c1424] text-[11px] font-mono text-slate-300 truncate border border-slate-800">
            Target: <span className="text-amber-300 font-bold">{endpoint.pingUrl}</span> • Zero simulated metrics
          </div>
        </div>
      )}

      {/* Alert Banner if Quality Degraded */}
      {status === 'completed' && hasAlerts && (
        <div className="mt-3 p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="truncate font-medium">
            <span className="font-bold text-amber-300">Notice: </span>
            <span>
              Threshold breached (
              {[
                isDownloadLow ? 'Down <25 Mbps' : null,
                isUploadLow ? 'Up <25 Mbps' : null,
                isPingHigh ? 'Ping >110ms' : null,
                isJitterHigh ? 'Jitter >110ms' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              )
            </span>
          </div>
        </div>
      )}

      {/* 4 Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3.5">
        {/* Download */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            isDownloadLow
              ? 'bg-amber-950/30 border-amber-500/60'
              : status === 'completed'
              ? 'bg-[#0c1424] border-cyan-400/40'
              : status === 'testing' && stage === 'download'
              ? 'bg-[#0c1424] border-cyan-400/70 ring-1 ring-cyan-400/50'
              : 'bg-[#0c1424] border-slate-700/70'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1 truncate">
              <ArrowDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              Download
            </span>
            {isDownloadLow ? (
              <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1 py-0.5 rounded border border-amber-500/30">
                &lt;25
              </span>
            ) : status === 'completed' ? (
              <span className="text-[10px] font-mono text-emerald-400 font-bold">Done</span>
            ) : status === 'testing' && stage === 'download' ? (
              <span className="text-[10px] font-mono text-cyan-300 font-bold">Live</span>
            ) : (
              <span className="text-[10px] font-mono text-slate-400 font-semibold">{status === 'failed' ? 'Failed' : 'Pending'}</span>
            )}
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-black font-mono tracking-tight text-white">
              {result !== null
                ? result.downloadMbps.toFixed(2)
                : liveMetrics?.currentDownloadMbps !== null && liveMetrics?.currentDownloadMbps !== undefined
                ? liveMetrics.currentDownloadMbps.toFixed(2)
                : '--'}
            </span>
            <span className="text-xs font-mono font-bold text-slate-400">Mbps</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">Multi-stream</p>
        </div>

        {/* Upload */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            isUploadLow
              ? 'bg-amber-950/30 border-amber-500/60'
              : status === 'completed'
              ? 'bg-[#0c1424] border-indigo-400/40'
              : status === 'testing' && stage === 'upload'
              ? 'bg-[#0c1424] border-indigo-400/70 ring-1 ring-indigo-400/50'
              : 'bg-[#0c1424] border-slate-700/70'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1 truncate">
              <ArrowUp className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              Upload
            </span>
            {isUploadLow ? (
              <span className="text-[10px] font-bold text-amber-300 bg-amber-500/20 px-1 py-0.5 rounded border border-amber-500/30">
                &lt;25
              </span>
            ) : status === 'completed' ? (
              <span className="text-[10px] font-mono text-emerald-400 font-bold">Done</span>
            ) : status === 'testing' && stage === 'upload' ? (
              <span className="text-[10px] font-mono text-indigo-300 font-bold">Live</span>
            ) : (
              <span className="text-[10px] font-mono text-slate-400 font-semibold">{status === 'failed' ? 'Failed' : 'Pending'}</span>
            )}
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-black font-mono tracking-tight text-white">
              {result !== null
                ? result.uploadMbps.toFixed(2)
                : liveMetrics?.currentUploadMbps !== null && liveMetrics?.currentUploadMbps !== undefined
                ? liveMetrics.currentUploadMbps.toFixed(2)
                : '--'}
            </span>
            <span className="text-xs font-mono font-bold text-slate-400">Mbps</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">Binary POST</p>
        </div>

        {/* Ping */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            isPingHigh
              ? 'bg-rose-950/30 border-rose-500/60'
              : status === 'completed'
              ? 'bg-[#0c1424] border-amber-400/40'
              : status === 'testing' && stage === 'ping'
              ? 'bg-[#0c1424] border-amber-400/70 ring-1 ring-amber-400/50'
              : 'bg-[#0c1424] border-slate-700/70'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1 truncate">
              <Wifi className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              Ping
            </span>
            {isPingHigh ? (
              <span className="text-[10px] font-bold text-rose-300 bg-rose-500/20 px-1 py-0.5 rounded border border-rose-500/30">
                &gt;110
              </span>
            ) : status === 'completed' ? (
              <span className="text-[10px] font-mono text-emerald-400 font-bold">Done</span>
            ) : status === 'testing' && stage === 'ping' ? (
              <span className="text-[10px] font-mono text-amber-300 font-bold">Probe</span>
            ) : (
              <span className="text-[10px] font-mono text-slate-400 font-semibold">{status === 'failed' ? 'Failed' : 'Pending'}</span>
            )}
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-black font-mono tracking-tight text-white">
              {result !== null
                ? result.pingMs.toFixed(1)
                : liveMetrics?.pingMs !== null && liveMetrics?.pingMs !== undefined
                ? liveMetrics.pingMs.toFixed(1)
                : '--'}
            </span>
            <span className="text-xs font-mono font-bold text-slate-400">ms</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">10 probes</p>
        </div>

        {/* Jitter */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            isJitterHigh
              ? 'bg-rose-950/30 border-rose-500/60'
              : status === 'completed'
              ? 'bg-[#0c1424] border-sky-400/40'
              : status === 'testing' && stage === 'jitter'
              ? 'bg-[#0c1424] border-sky-400/70 ring-1 ring-sky-400/50'
              : 'bg-[#0c1424] border-slate-700/70'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1 truncate">
              <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              Jitter
            </span>
            {isJitterHigh ? (
              <span className="text-[10px] font-bold text-rose-300 bg-rose-500/20 px-1 py-0.5 rounded border border-rose-500/30">
                &gt;110
              </span>
            ) : status === 'completed' ? (
              <span className="text-[10px] font-mono text-emerald-400 font-bold">Done</span>
            ) : status === 'testing' && stage === 'jitter' ? (
              <span className="text-[10px] font-mono text-sky-300 font-bold">Probe</span>
            ) : (
              <span className="text-[10px] font-mono text-slate-400 font-semibold">{status === 'failed' ? 'Failed' : 'Pending'}</span>
            )}
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-black font-mono tracking-tight text-white">
              {result !== null
                ? result.jitterMs.toFixed(2)
                : liveMetrics?.jitterMs !== null && liveMetrics?.jitterMs !== undefined
                ? liveMetrics.jitterMs.toFixed(2)
                : '--'}
            </span>
            <span className="text-xs font-mono font-bold text-slate-400">ms</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">RFC 3550</p>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3.5 pt-2.5 border-t border-slate-700/70 flex items-center justify-between text-xs text-slate-300 font-mono">
        <div className="truncate">
          <span>Server: <strong className="text-white font-bold">{endpoint.serverCode}</strong></span>
          <span className="mx-1.5 text-slate-500">•</span>
          <span className="text-slate-300">{endpoint.description}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline font-sans text-slate-300 font-medium">Direct LibreSpeed</span>
        </div>
      </div>
    </section>
  );
};
