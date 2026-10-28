import React from 'react';
import { TestStage } from '../services/speedTestEngine';
import { ArrowDown, ArrowUp, Activity, Zap, AlertTriangle } from 'lucide-react';

interface SpeedGaugeProps {
  stage: TestStage;
  currentDownloadMbps: number | null;
  currentUploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  progressPercent: number;
}

export const SpeedGauge: React.FC<SpeedGaugeProps> = ({
  stage,
  currentDownloadMbps,
  currentUploadMbps,
  pingMs,
  jitterMs,
  progressPercent,
}) => {
  // Determine primary display metric depending on current stage
  let displayValue = '0.00';
  let displayUnit = 'Mbps';
  let displayLabel = 'Ready to Benchmark';
  let activeColor = 'cyan';
  let gaugeSpeedNumber = 0;

  if (stage === 'ping') {
    displayValue = pingMs !== null ? pingMs.toFixed(1) : '--';
    displayUnit = 'ms';
    displayLabel = 'Testing Ping (Latency)';
    activeColor = 'amber';
    gaugeSpeedNumber = pingMs ? Math.min(100, (pingMs / 150) * 100) : 25;
  } else if (stage === 'jitter') {
    displayValue = jitterMs !== null ? jitterMs.toFixed(2) : '--';
    displayUnit = 'ms';
    displayLabel = 'Testing Jitter (Delay Variation)';
    activeColor = 'sky';
    gaugeSpeedNumber = jitterMs ? Math.min(100, (jitterMs / 40) * 100) : 25;
  } else if (stage === 'download') {
    displayValue = currentDownloadMbps !== null ? currentDownloadMbps.toFixed(2) : '0.00';
    displayUnit = 'Mbps';
    displayLabel = 'Testing Download Speed';
    activeColor = 'cyan';
    gaugeSpeedNumber = currentDownloadMbps || 0;
  } else if (stage === 'upload') {
    displayValue = currentUploadMbps !== null ? currentUploadMbps.toFixed(2) : '0.00';
    displayUnit = 'Mbps';
    displayLabel = 'Testing Upload Speed';
    activeColor = 'indigo';
    gaugeSpeedNumber = currentUploadMbps || 0;
  } else if (stage === 'complete') {
    displayValue = currentDownloadMbps !== null ? currentDownloadMbps.toFixed(2) : '0.00';
    displayUnit = 'Mbps';
    displayLabel = 'Benchmark Finished';
    activeColor = 'emerald';
    gaugeSpeedNumber = currentDownloadMbps || 0;
  } else if (stage === 'error') {
    displayValue = '--';
    displayUnit = '';
    displayLabel = 'Connection Blocked';
    activeColor = 'rose';
    gaugeSpeedNumber = 0;
  }

  // Calculate SVG arc angle (from -135deg to +135deg, total 270 degrees)
  // Scale max value non-linearly to look great from 1 Mbps to 500 Mbps
  const maxBenchmarkScale = 200;
  const normalizedRatio = Math.min(1, Math.max(0, gaugeSpeedNumber / maxBenchmarkScale));
  const arcDasharray = 565; // 2 * PI * r (approx for r=90)
  const arcDashoffset = arcDasharray - arcDasharray * (normalizedRatio * 0.75);

  const getStageBadge = () => {
    switch (stage) {
      case 'ping':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            Phase 1: Ping (Latency) Probe
          </span>
        );
      case 'jitter':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse">
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            Phase 2: Jitter Analysis
          </span>
        );
      case 'download':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            <ArrowDown className="w-3.5 h-3.5 text-cyan-400 animate-bounce" />
            Phase 3: Multi-Stream Download
          </span>
        );
      case 'upload':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
            <ArrowUp className="w-3.5 h-3.5 text-indigo-400 animate-bounce" />
            Phase 4: Multi-Stream Upload
          </span>
        );
      case 'complete':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            Test Complete
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            Connection Blocked
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            Standby
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-900/80 border border-slate-800 rounded-2xl relative overflow-hidden shadow-2xl backdrop-blur-xl">
      {/* Background ambient glow */}
      <div
        className={`absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl pointer-events-none transition-all duration-700 opacity-20 ${
          activeColor === 'cyan'
            ? 'bg-cyan-500'
            : activeColor === 'indigo'
            ? 'bg-indigo-600'
            : activeColor === 'amber'
            ? 'bg-amber-500'
            : activeColor === 'emerald'
            ? 'bg-emerald-500'
            : activeColor === 'rose'
            ? 'bg-rose-500'
            : 'bg-slate-700'
        }`}
      />

      {/* Stage Badge */}
      <div className="mb-4 z-10">{getStageBadge()}</div>

      {/* Speedometer Gauge Graphic */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 220 220">
          {/* Background track circle */}
          <circle
            cx="110"
            cy="110"
            r="85"
            className="stroke-slate-800"
            strokeWidth="12"
            fill="transparent"
            strokeDasharray="534"
            strokeDashoffset="133"
            strokeLinecap="round"
          />

          {/* Active progress arc */}
          <circle
            cx="110"
            cy="110"
            r="85"
            className={`transition-all duration-300 ease-out ${
              activeColor === 'cyan'
                ? 'stroke-cyan-400 filter drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                : activeColor === 'indigo'
                ? 'stroke-indigo-400 filter drop-shadow-[0_0_8px_rgba(99,102,241,0.6)]'
                : activeColor === 'amber'
                ? 'stroke-amber-400 filter drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                : activeColor === 'emerald'
                ? 'stroke-emerald-400 filter drop-shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                : 'stroke-slate-600'
            }`}
            strokeWidth="12"
            fill="transparent"
            strokeDasharray="534"
            strokeDashoffset={Math.max(133, 534 - (normalizedRatio * 400))}
            strokeLinecap="round"
          />
        </svg>

        {/* Center reading */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
            {displayLabel}
          </div>
          <div className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-white">
            {displayValue}
          </div>
          <div className="text-sm font-semibold font-mono text-cyan-400 tracking-wide mt-0.5">
            {displayUnit}
          </div>

          {/* Test progress indicator inside gauge */}
          {stage !== 'idle' && stage !== 'complete' && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
              <span>Overall:</span>
              <span className="font-bold text-white">{progressPercent}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar across bottom of gauge card */}
      {stage !== 'idle' && (
        <div className="w-full mt-4 max-w-sm">
          <div className="flex justify-between text-xs text-slate-400 mb-1 font-mono">
            <span>Progress</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                activeColor === 'cyan'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500'
                  : activeColor === 'indigo'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-500'
                  : activeColor === 'amber'
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
