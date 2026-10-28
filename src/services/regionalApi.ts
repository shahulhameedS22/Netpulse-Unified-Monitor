/**
 * Regional Ping API Integration Layer
 * 
 * Manages authorized regional server endpoints (IN-DC01, IN-DC02, LK-DC01, SG-DC01).
 * Features:
 * - Real ICMP ping dispatch against 8.8.8.8
 * - Live endpoint connectivity testing
 * - Push mode polling when queued on serverless
 * - Zero simulated or fake fallback data
 */

import { type RegionId, type RegionPingResult, type PingPacket } from '../types/ping';
import { UNIFIED_ENDPOINTS } from '../config/endpoints';
import { publishPingAlert } from './alertCenter';

const STORAGE_KEY = 'unified_ping_endpoints_v1';

export function isValidIpv4(ip: string): boolean {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip.trim());
}

export function isValidPingCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= 100;
}

export interface RegionalPingApiRequest {
  regionId: RegionId;
  targetIp: string;
  count: number;
  timeoutMs?: number;
  sessionId: string;
}

export interface RegionalPingApiResponse {
  success: boolean;
  regionId: RegionId;
  targetIp: string;
  requestsSent: number;
  successfulReplies: number;
  failedRequests: number;
  packetLossPercent: number;
  minLatencyMs: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  jitterMs: number | null;
  rawOutputSnippet?: string;
  packets?: Array<{
    sequence: number;
    latencyMs: number | null;
    ttl?: number;
    success: boolean;
  }>;
  executionDurationMs: number;
  timestamp: string;
  serverVersion?: string;
  error?: string;
}

export interface RegionalEndpointConfig {
  baseUrl: string;
  isEnabled: boolean;
  isCustomized?: boolean;
}

export function getStoredEndpoints(): Partial<Record<RegionId, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveStoredEndpoints(endpoints: Record<RegionId, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
  } catch (e) {
    console.error('Failed to save regional endpoints:', e);
  }
}

export function getRegionalEndpoints(): Record<RegionId, RegionalEndpointConfig> {
  const stored = getStoredEndpoints();
  const globalBase = (import.meta.env.VITE_REGIONAL_API_BASE_URL as string) || '';

  const resolveUrl = (regionId: RegionId, envKey: string, defaultPath: string) => {
    if (stored[regionId] !== undefined && stored[regionId] !== null) {
      const val = stored[regionId]!.trim();
      if (val.length > 0) return { url: val, isCustomized: true };
    }
    const envVal = ((import.meta.env[envKey] as string) || '').trim();
    if (envVal && envVal.toLowerCase() !== 'none' && (envVal.startsWith('http://') || envVal.startsWith('https://') || envVal.startsWith('/'))) {
      return { url: envVal, isCustomized: false };
    }
    if (globalBase.trim().length > 0) {
      return { url: `${globalBase.replace(/\/+$/, '')}/${defaultPath}`, isCustomized: false };
    }
    return { url: `/api/regions/${regionId}`, isCustomized: false };
  };

  const inDc01 = resolveUrl('IN-DC01', 'VITE_IN_DC01_API_URL', 'in-dc01');
  const inDc02 = resolveUrl('IN-DC02', 'VITE_IN_DC02_API_URL', 'in-dc02');
  const lkDc01 = resolveUrl('LK-DC01', 'VITE_LK_DC01_API_URL', 'lk-dc01');
  const sgDc01 = resolveUrl('SG-DC01', 'VITE_SG_DC01_API_URL', 'sg-dc01');

  return {
    'IN-DC01': { baseUrl: inDc01.url, isEnabled: Boolean(inDc01.url), isCustomized: inDc01.isCustomized },
    'IN-DC02': { baseUrl: inDc02.url, isEnabled: Boolean(inDc02.url), isCustomized: inDc02.isCustomized },
    'LK-DC01': { baseUrl: lkDc01.url, isEnabled: Boolean(lkDc01.url), isCustomized: lkDc01.isCustomized },
    'SG-DC01': { baseUrl: sgDc01.url, isEnabled: Boolean(sgDc01.url), isCustomized: sgDc01.isCustomized },
  };
}

export async function testRegionalEndpointConnection(
  regionId: RegionId,
  customUrl?: string
): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; message: string; serverInfo?: any }> {
  const endpoints = getRegionalEndpoints();
  const url = (customUrl !== undefined ? customUrl : endpoints[regionId]?.baseUrl || '').trim();

  if (!url) {
    return { ok: false, latencyMs: 0, message: 'Endpoint URL is not set.' };
  }

  const startTime = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const healthUrl = `${url.replace(/\/+$/, '')}/health`;
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startTime);

    if (res.ok) {
      let serverInfo = null;
      try { serverInfo = await res.json(); } catch {}
      return { ok: true, statusCode: res.status, latencyMs, message: `HTTP ${res.status} OK (${latencyMs} ms)`, serverInfo };
    } else {
      let message = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const j = await res.json();
        if (j.message) message = j.message;
        else if (j.error) message = j.error;
      } catch {}
      return { ok: false, statusCode: res.status, latencyMs, message };
    }
  } catch (err: any) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      ok: false,
      latencyMs,
      message: err.name === 'AbortError' ? 'Connection timed out (8s).' : (err.message || 'Network error'),
    };
  }
}

const PUSH_POLL_EVERY_MS = 2500;
const PUSH_MAX_WAIT_MS = 90_000;

async function readPingResponse(response: Response, baseUrl: string, regionId: string): Promise<any> {
  const first = await response.json();
  if (response.status !== 202 && first?.status !== 'queued' && !first?.requestId) {
    return first;
  }
  const requestId = first?.requestId;
  if (!requestId) return first;

  const url = `${baseUrl.replace(/\/+$/, '')}/result?requestId=${encodeURIComponent(requestId)}`;
  const deadline = Date.now() + PUSH_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, PUSH_POLL_EVERY_MS));
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (r.status === 202) continue;
    const body = await r.json().catch(() => ({} as any));
    
    // In push mode, body.status can be 'pending', 'running', or 'queued'
    if (body.status === 'pending' || body.status === 'running' || body.status === 'queued') {
      continue;
    }

    if (r.ok && body.status === 'done' && body.result) {
      return body.result;
    }

    throw new Error(
      `Regional server [${regionId}] HTTP ${r.status}: ${body.error || body.message || 'Could not retrieve result.'}`
    );
  }
  throw new Error(`Regional agent for ${regionId} did not return a result in time (${PUSH_MAX_WAIT_MS / 1000}s).`);
}

export async function executeRealRegionalPing(
  req: RegionalPingApiRequest,
  userAuthToken: string = ''
): Promise<RegionPingResult> {
  const endpoints = getRegionalEndpoints();
  const config = endpoints[req.regionId];

  if (!config || !config.baseUrl) {
    throw new Error(`Regional API endpoint for ${req.regionId} is not configured.`);
  }

  const targetIp = (req.targetIp || '8.8.8.8').trim();
  if (!isValidIpv4(targetIp)) throw new Error(`Invalid target IPv4: ${targetIp}`);

  const count = Math.min(Math.max(1, req.count || 30), 30);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  const cleanBase = config.baseUrl.replace(/\/+$/, '');
  const pingUrl = `${cleanBase}/ping`;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Session-ID': req.sessionId,
    };
    if (userAuthToken) headers['Authorization'] = `Bearer ${userAuthToken}`;

    const response = await fetch(pingUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        targetIp,
        count,
        timeoutMs: req.timeoutMs || 35000,
        regionId: req.regionId,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError = errorText;
      try {
        const j = JSON.parse(errorText);
        if (j.error) parsedError = j.error;
        else if (j.message) parsedError = j.message;
      } catch {}
      throw new Error(`Server [${req.regionId}] HTTP ${response.status}: ${parsedError || response.statusText}`);
    }

    const data: RegionalPingApiResponse = await readPingResponse(response, cleanBase, req.regionId);

    if (!data.success && data.error) {
      throw new Error(`Server [${req.regionId}]: ${data.error}`);
    }

    const packets: PingPacket[] = (data.packets || []).map((p, idx) => ({
      sequence: p.sequence ?? idx + 1,
      latencyMs: p.latencyMs,
      ttl: p.ttl,
      success: p.success,
      timestamp: new Date().toISOString(),
    }));

    const loss = typeof data.packetLossPercent === 'number'
      ? data.packetLossPercent
      : Math.round(((data.requestsSent - data.successfulReplies) / data.requestsSent) * 100);

    let status: 'Success' | 'Partial Loss' | 'Failed' = 'Success';
    if (loss === 100) status = 'Failed';
    else if (loss > 0) status = 'Partial Loss';

    const ep = UNIFIED_ENDPOINTS.find(e => e.serverCode === req.regionId);

    return {
      regionId: req.regionId,
      regionName: `${req.regionId} — ${ep?.fullName || req.regionId}`,
      targetIp,
      status,
      requestsSent: data.requestsSent,
      successfulReplies: data.successfulReplies,
      failedRequests: data.failedRequests ?? Math.max(0, data.requestsSent - data.successfulReplies),
      packetLossPercent: loss,
      minLatencyMs: data.minLatencyMs,
      avgLatencyMs: data.avgLatencyMs,
      maxLatencyMs: data.maxLatencyMs,
      jitterMs: data.jitterMs,
      durationMs: data.executionDurationMs,
      startedAt: new Date(Date.now() - (data.executionDurationMs || 30000)).toISOString(),
      completedAt: data.timestamp || new Date().toISOString(),
      errorDetails: data.error || null,
      packets,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error(`Regional server [${req.regionId}] timed out after 45s.`);
    throw err;
  }
}
