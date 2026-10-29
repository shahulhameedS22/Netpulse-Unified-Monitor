export interface SpeedRegionResult {
  serverCode: string;
  name: string;
  country: string;
  status: 'completed' | 'failed' | 'waiting';
  downloadMbps: number | null;
  uploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  errorMessage?: string | null;
}

export interface SpeedSessionSummary {
  totalRegions: number;
  completedRegions: number;
  failedRegions: number;
  avgDownloadMbps: number;
  avgUploadMbps: number;
  avgPingMs: number;
  peakDownloadMbps: number;
}

export interface SpeedTestSession {
  id: string;
  startedAt: string;
  completedAt?: string;
  regions: Record<string, SpeedRegionResult>;
  summary: SpeedSessionSummary;
}
