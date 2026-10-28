import { TestEndpoint } from '../config/endpoints';

export type TestStage = 'idle' | 'ping' | 'jitter' | 'download' | 'upload' | 'complete' | 'error';
export type RegionStatus = 'waiting' | 'testing' | 'completed' | 'failed';

export interface LiveMetrics {
  stage: TestStage;
  progressPercent: number;
  pingMs: number | null;
  jitterMs: number | null;
  currentDownloadMbps: number | null;
  currentUploadMbps: number | null;
  pingProgress: number;
  jitterProgress: number;
  downloadProgress: number;
  uploadProgress: number;
}

export interface SpeedTestResult {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  endpoint: TestEndpoint;
  timestamp: string;
}

export interface RegionState {
  endpoint: TestEndpoint;
  status: RegionStatus;
  stage: TestStage;
  liveMetrics: LiveMetrics | null;
  result: SpeedTestResult | null;
  errorMessage: string | null;
}
