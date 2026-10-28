import React from 'react';
import { type PingStatus } from '../types/ping';
import { Check, AlertTriangle, X, PlayCircle, Clock } from 'lucide-react';

interface StatusBadgeProps {
  status: PingStatus;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const getBadgeConfig = () => {
    switch (status) {
      case 'Success':
        return {
          bg: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-xs shadow-emerald-500/10',
          icon: Check,
          label: 'Success',
        };
      case 'Partial Loss':
        return {
          bg: 'bg-amber-500/20 text-amber-300 border border-amber-400/40 shadow-xs shadow-amber-500/10',
          icon: AlertTriangle,
          label: 'Partial Loss',
        };
      case 'Failed':
        return {
          bg: 'bg-rose-500/20 text-rose-300 border border-rose-400/40 shadow-xs shadow-rose-500/10',
          icon: X,
          label: 'Failed',
        };
      case 'Unavailable':
        return {
          bg: 'bg-slate-800 text-slate-300 border border-slate-700',
          icon: Clock,
          label: 'Unavailable',
        };
      case 'Running':
        return {
          bg: 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 animate-pulse shadow-xs shadow-cyan-500/10',
          icon: PlayCircle,
          label: 'Running',
        };
      case 'Not Tested':
      default:
        return {
          bg: 'bg-slate-800 text-slate-300 border border-slate-700',
          icon: Clock,
          label: 'Not Tested',
        };
    }
  };

  const config = getBadgeConfig();
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-[11px] px-2.5 py-0.5 gap-1 font-bold',
    md: 'text-xs px-3 py-1 gap-1.5 font-bold',
    lg: 'text-sm px-3.5 py-1.5 gap-2 font-black',
  }[size];

  return (
    <span
      className={`inline-flex items-center rounded-full tracking-wide select-none ${config.bg} ${sizeClasses}`}
    >
      <Icon className={size === 'sm' ? 'w-3 h-3 stroke-[2.5]' : 'w-3.5 h-3.5 stroke-[2.5]'} />
      <span>{config.label}</span>
    </span>
  );
};
