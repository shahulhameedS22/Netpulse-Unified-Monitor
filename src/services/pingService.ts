/**
 * Unified Regional Ping Service Orchestrator
 * 
 * Manages concurrent test dispatch across the four regional data center APIs.
 * Zero simulated data.
 */

import {
  type RegionId,
  type RegionPingResult,
  type SessionSummary,
  type PingSession,
} from '../types/ping';
import { UNIFIED_ENDPOINTS } from '../config/endpoints';
import {
  executeRealRegionalPing,
  isValidIpv4,
  isValidPingCount,
} from './regionalApi';

export interface ExecuteSessionOptions {
  userId?: string;
  userEmail?: string;
  targetIp?: string;
  pingCount?: number;
  onRegionProgress?: (regionId: RegionId, result: RegionPingResult) => void;
  getUserToken?: () => Promise<string | null>;
}

export function calculateSessionSummary(
  regions: Record<RegionId, RegionPingResult>
): SessionSummary {
  const list = Object.values(regions);
  const totalRegions = list.length;

  const testedList = list.filter(r => r.status !== 'Not Tested' && r.status !== 'Running');
  if (testedList.length === 0) {
    return {
      totalRegions: 4,
      successfulRegions: null,
      partialLossRegions: null,
      failedOrUnavailableRegions: null,
      overallAvgLatencyMs: null,
      minLatencyMs: null,
      maxLatencyMs: null,
    };
  }

  const successfulRegions = testedList.filter(r => r.status === 'Success').length;
  const partialLossRegions = testedList.filter(r => r.status === 'Partial Loss').length;
  const failedOrUnavailableRegions = testedList.filter(
    r => r.status === 'Failed' || r.status === 'Unavailable'
  ).length;

  const validAverages = testedList
    .filter(r => r.avgLatencyMs !== null && typeof r.avgLatencyMs === 'number')
    .map(r => r.avgLatencyMs as number);

  const validMins = testedList
    .filter(r => r.minLatencyMs !== null && typeof r.minLatencyMs === 'number')
    .map(r => r.minLatencyMs as number);

  const validMaxs = testedList
    .filter(r => r.maxLatencyMs !== null && typeof r.maxLatencyMs === 'number')
    .map(r => r.maxLatencyMs as number);

  const overallAvgLatencyMs = validAverages.length > 0
    ? parseFloat((validAverages.reduce((a, b) => a + b, 0) / validAverages.length).toFixed(1))
    : null;

  const minLatencyMs = validMins.length > 0 ? Math.min(...validMins) : null;
  const maxLatencyMs = validMaxs.length > 0 ? Math.max(...validMaxs) : null;

  return {
    totalRegions,
    successfulRegions,
    partialLossRegions,
    failedOrUnavailableRegions,
    overallAvgLatencyMs,
    minLatencyMs,
    maxLatencyMs,
  };
}

export function createInitialRegionalResults(targetIp: string = '8.8.8.8'): Record<RegionId, RegionPingResult> {
  const ids: RegionId[] = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];
  const res: Partial<Record<RegionId, RegionPingResult>> = {};

  for (const id of ids) {
    const ep = UNIFIED_ENDPOINTS.find(e => e.serverCode === id);
    res[id] = {
      regionId: id,
      regionName: `${id} — ${ep?.fullName || id}`,
      targetIp,
      status: 'Not Tested',
      requestsSent: null,
      successfulReplies: null,
      failedRequests: null,
      packetLossPercent: null,
      minLatencyMs: null,
      avgLatencyMs: null,
      maxLatencyMs: null,
      jitterMs: null,
      durationMs: null,
      startedAt: null,
      completedAt: null,
      errorDetails: null,
      packets: [],
    };
  }

  return res as Record<RegionId, RegionPingResult>;
}

export async function executePingSession(
  options: ExecuteSessionOptions
): Promise<PingSession> {
  const targetIp = options.targetIp ?? '8.8.8.8';
  const pingCount = options.pingCount ?? 30;

  if (!isValidIpv4(targetIp)) {
    throw new Error(`Target IP must be a valid IPv4 address. Received: "${targetIp}"`);
  }
  if (!isValidPingCount(pingCount)) {
    throw new Error(`Ping count must be between 1 and 30. Received: ${pingCount}`);
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const startedAt = new Date().toISOString();
  const token = options.getUserToken ? await options.getUserToken() : '';
  const regionIds: RegionId[] = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'];

  const initialRegions = createInitialRegionalResults(targetIp);
  for (const rid of regionIds) {
    initialRegions[rid].status = 'Running';
    initialRegions[rid].startedAt = startedAt;
    options.onRegionProgress?.(rid, initialRegions[rid]);
  }

  const finalRegions: Record<RegionId, RegionPingResult> = { ...initialRegions };

  await Promise.all(
    regionIds.map(async (rid) => {
      try {
        const result = await executeRealRegionalPing(
          {
            regionId: rid,
            targetIp,
            count: pingCount,
            sessionId,
          },
          token || ''
        );
        finalRegions[rid] = result;
        options.onRegionProgress?.(rid, result);
      } catch (err: any) {
        const errorMsg = err?.message || 'Regional endpoint connection failure';
        const isMissingConfig = errorMsg.includes('not configured');
        const ep = UNIFIED_ENDPOINTS.find(e => e.serverCode === rid);

        const failedResult: RegionPingResult = {
          regionId: rid,
          regionName: `${rid} — ${ep?.fullName || rid}`,
          targetIp,
          status: isMissingConfig ? 'Unavailable' : 'Failed',
          requestsSent: 0,
          successfulReplies: 0,
          failedRequests: pingCount,
          packetLossPercent: 100,
          minLatencyMs: null,
          avgLatencyMs: null,
          maxLatencyMs: null,
          jitterMs: null,
          durationMs: null,
          startedAt,
          completedAt: new Date().toISOString(),
          errorDetails: errorMsg,
          packets: [],
        };
        finalRegions[rid] = failedResult;
        options.onRegionProgress?.(rid, failedResult);
      }
    })
  );

  const completedAt = new Date().toISOString();
  const summary = calculateSessionSummary(finalRegions);

  let sessionStatus: 'success' | 'partial_loss' | 'failed' = 'success';
  if ((summary.failedOrUnavailableRegions ?? 0) === 4) {
    sessionStatus = 'failed';
  } else if ((summary.failedOrUnavailableRegions ?? 0) > 0 || (summary.partialLossRegions ?? 0) > 0) {
    sessionStatus = 'partial_loss';
  }

  return {
    id: sessionId,
    userId: options.userId,
    userEmail: options.userEmail,
    targetIp,
    pingCount,
    status: sessionStatus,
    isSimulated: false,
    startedAt,
    completedAt,
    summary,
    regions: finalRegions,
  };
}
