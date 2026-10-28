/**
 * LibreSpeed Engine Orchestrator
 *
 * Runs the real LibreSpeed client engine using Web Worker:
 *   /speedtest.js
 *   /speedtest_worker.js
 *
 * Configured with settings mirroring official telemetry:
 *   12s download, 12s upload, 0 grace time, fixed duration (time_auto = false).
 *   Ping, jitter, stream counts, and speed formulas computed in real-time.
 */

import { TestEndpoint } from '../config/endpoints';
import { LiveMetrics, SpeedTestResult, TestStage } from '../types/speed';

export type { LiveMetrics, SpeedTestResult, TestStage };

export interface SpeedTestCallbacks {
  onProgress: (metrics: LiveMetrics) => void;
  onComplete: (result: SpeedTestResult) => void;
  onError: (errorMessage: string) => void;
  onCancelled: () => void;
}

declare global {
  interface Window {
    Speedtest?: any;
  }
}

function loadLibreSpeed(): Promise<void> {
  if (typeof window !== 'undefined' && window.Speedtest) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/speedtest.js';
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Could not load /speedtest.js from public/ folder.'));
    document.head.appendChild(script);
  });
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export class SpeedTestEngine {
  private running = false;
  private current: any = null;

  public isTestRunning(): boolean {
    return this.running;
  }

  public stopTest(): void {
    try {
      if (this.current) this.current.abort();
    } catch {
      /* not started yet */
    }
  }

  public async startTest(endpoint: TestEndpoint, callbacks: SpeedTestCallbacks): Promise<void> {
    if (this.running) throw new Error('A speed test is already running.');
    this.running = true;

    const metrics: LiveMetrics = {
      stage: 'ping',
      progressPercent: 0,
      pingMs: null,
      jitterMs: null,
      currentDownloadMbps: null,
      currentUploadMbps: null,
      pingProgress: 0,
      jitterProgress: 0,
      downloadProgress: 0,
      uploadProgress: 0,
    };
    const emit = () => callbacks.onProgress({ ...metrics });

    try {
      if (!endpoint?.pingUrl || !endpoint.downloadUrl || !endpoint.uploadUrl) {
        throw new Error('Invalid endpoint configuration.');
      }
      await loadLibreSpeed();
      emit();

      await new Promise<void>((resolve) => {
        const st = new window.Speedtest!();
        this.current = st;

        st.setParameter('telemetry_level', 'off');
        st.setParameter('test_order', 'P_D_U'); // ping+jitter, download, upload
        st.setParameter('time_dl_max', 12);
        st.setParameter('time_ul_max', 12);
        st.setParameter('time_dlGraceTime', 0);
        st.setParameter('time_ulGraceTime', 0);
        st.setParameter('time_auto', false);

        // Report real failures instead of silently retrying forever
        st.setParameter('xhr_ignoreErrors', 0);
        // Keep each upload POST under PHP's default 8 MB post_max_size
        st.setParameter('xhr_ul_blob_megabytes', 4);

        st.setParameter('url_dl', endpoint.downloadUrl);
        st.setParameter('url_ul', endpoint.uploadUrl);
        st.setParameter('url_ping', endpoint.pingUrl);

        let last: any = null;

        st.onupdate = (d: any) => {
          last = d;
          const dl = num(d.dlStatus);
          const ul = num(d.ulStatus);
          const ping = num(d.pingStatus);
          const jitter = num(d.jitterStatus);

          metrics.pingMs = ping !== null && ping > 0 ? ping : metrics.pingMs;
          metrics.jitterMs = jitter !== null && (ping ?? 0) > 0 ? jitter : metrics.jitterMs;

          if (d.testState === 2) {
            metrics.stage = 'ping';
            metrics.pingProgress = Math.round((d.pingProgress || 0) * 100);
            metrics.jitterProgress = metrics.pingProgress;
            metrics.progressPercent = Math.round(2 + (d.pingProgress || 0) * 13);
          } else if (d.testState === 1) {
            metrics.stage = 'download';
            metrics.pingProgress = 100;
            metrics.jitterProgress = 100;
            if (dl !== null) metrics.currentDownloadMbps = dl;
            metrics.downloadProgress = Math.round((d.dlProgress || 0) * 100);
            metrics.progressPercent = Math.round(15 + (d.dlProgress || 0) * 42);
          } else if (d.testState === 3) {
            metrics.stage = 'upload';
            metrics.pingProgress = 100;
            metrics.jitterProgress = 100;
            metrics.downloadProgress = 100;
            if (dl !== null) metrics.currentDownloadMbps = dl;
            if (ul !== null) metrics.currentUploadMbps = ul;
            metrics.uploadProgress = Math.round((d.ulProgress || 0) * 100);
            metrics.progressPercent = Math.round(57 + (d.ulProgress || 0) * 43);
          }
          if (d.testState >= 1 && d.testState <= 3) emit();
        };

        st.onend = (aborted: boolean) => {
          this.current = null;
          this.running = false;
          try { st.worker?.terminate?.(); } catch { /* ignore */ }

          if (aborted) {
            Object.assign(metrics, {
              stage: 'idle', progressPercent: 0, pingMs: null, jitterMs: null,
              currentDownloadMbps: null, currentUploadMbps: null,
              pingProgress: 0, jitterProgress: 0, downloadProgress: 0, uploadProgress: 0,
            });
            emit();
            callbacks.onCancelled();
            resolve();
            return;
          }

          const failedParts: string[] = [];
          if (String(last?.pingStatus) === 'Fail') failedParts.push('ping');
          if (String(last?.dlStatus) === 'Fail') failedParts.push('download');
          if (String(last?.ulStatus) === 'Fail') failedParts.push('upload');

          if (failedParts.length > 0 || !last) {
            Object.assign(metrics, {
              stage: 'error', progressPercent: 0, pingMs: null, jitterMs: null,
              currentDownloadMbps: null, currentUploadMbps: null,
              pingProgress: 0, jitterProgress: 0, downloadProgress: 0, uploadProgress: 0,
            });
            emit();
            callbacks.onError(
              `Direct browser connection to ${endpoint.name} (${endpoint.baseUrl}) failed. Check server CORS headers or port 8443 accessibility.`
            );
            resolve();
            return;
          }

          const result: SpeedTestResult = {
            downloadMbps: Number(last.dlStatus),
            uploadMbps: Number(last.ulStatus),
            pingMs: Number(last.pingStatus),
            jitterMs: Number(last.jitterStatus),
            endpoint,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          };

          Object.assign(metrics, {
            stage: 'complete', progressPercent: 100,
            currentDownloadMbps: result.downloadMbps, currentUploadMbps: result.uploadMbps,
            pingMs: result.pingMs, jitterMs: result.jitterMs,
            pingProgress: 100, jitterProgress: 100, downloadProgress: 100, uploadProgress: 100,
          });
          emit();
          callbacks.onComplete(result);
          resolve();
        };

        st.start();
      });
    } catch (err: any) {
      this.running = false;
      this.current = null;
      callbacks.onError(`${err?.message || err}`);
    }
  }
}

export const speedTestEngine = new SpeedTestEngine();
