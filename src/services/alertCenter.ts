import { RegionId } from '../types/ping';

export interface PingAlertEvent {
  regionId: RegionId;
  timeouts: number;
  total: number;
  maxConsecutive: number;
  packetLossPercent?: number;
  level?: 'warning' | 'critical';
  threshold?: number;
  emailStatus?: 'not_required' | 'sent' | 'skipped_cooldown' | 'not_configured' | 'failed';
}

type AlertListener = (event: PingAlertEvent) => void;
const listeners: Set<AlertListener> = new Set();

export function subscribePingAlerts(listener: AlertListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishPingAlert(event: PingAlertEvent): void {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // ignore
    }
  }
}
