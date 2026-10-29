/**
 * Ping Monitoring Data Type Definitions
 */

export type RegionId = 'IN-DC01' | 'IN-DC02' | 'LK-DC01' | 'SG-DC01';

export type PingStatus = 
  | 'Not Tested'
  | 'Running'
  | 'Success'
  | 'Partial Loss'
  | 'Failed'
  | 'Unavailable';

export interface PingPacket {
  sequence: number;
  success: boolean;
  latencyMs: number | null;
  ttl?: number;
  timestamp: string;
}

export interface RegionPingResult {
  regionId: RegionId;
  regionName: string;
  targetIp: string;
  status: PingStatus;
  requestsSent: number | null;
  successfulReplies: number | null;
  failedRequests: number | null;
  packetLossPercent: number | null;
  minLatencyMs: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  jitterMs: number | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorDetails?: string | null;
  packets?: PingPacket[];
}

export interface SessionSummary {
  totalRegions: number;
  successfulRegions: number | null;
  partialLossRegions: number | null;
  failedOrUnavailableRegions: number | null;
  overallAvgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
}

export interface PingSession {
  id: string;
  userId?: string;
  userEmail?: string;
  targetIp: string;
  pingCount: number;
  status: 'running' | 'success' | 'partial_loss' | 'failed' | 'not_tested';
  isSimulated: boolean;
  startedAt: string;
  completedAt?: string;
  createdAt?: string;
  summary: SessionSummary;
  regions: Record<RegionId, RegionPingResult>;
}

export const COUNTRY_CODES: Record<RegionId, 'IN' | 'SL' | 'SG'> = {
  'IN-DC01': 'IN',
  'IN-DC02': 'IN',
  'LK-DC01': 'SL',
  'SG-DC01': 'SG',
};

export const REGIONS: Record<RegionId, {
  id: RegionId;
  name: string;
  fullName: string;
  countryCode: 'IN' | 'SL' | 'SG';
  location: string;
  country: string;
  provider: string;
  flagUrl: string;
}> = {
  'IN-DC01': {
    id: 'IN-DC01',
    name: 'IN-DC01',
    fullName: 'Bangalore Data Center',
    countryCode: 'IN',
    location: 'Tier III Data Center',
    country: 'India',
    provider: 'TATA Node',
    flagUrl: '/flags/in.svg',
  },
  'IN-DC02': {
    id: 'IN-DC02',
    name: 'IN-DC02',
    fullName: 'Bangalore Data Center',
    countryCode: 'IN',
    location: 'Tier III Data Center',
    country: 'India',
    provider: 'ACT Node',
    flagUrl: '/flags/in.svg',
  },
  'LK-DC01': {
    id: 'LK-DC01',
    name: 'LK-DC01',
    fullName: 'Srilanka Data Center',
    countryCode: 'SL',
    location: 'SLT Tier III Facility',
    country: 'Sri Lanka',
    provider: 'SLT-Mobitel',
    flagUrl: '/flags/lk.svg',
  },
  'SG-DC01': {
    id: 'SG-DC01',
    name: 'SG-DC01',
    fullName: 'Singapore Data Center',
    countryCode: 'SG',
    location: 'Equinix SG2 Facility',
    country: 'Singapore',
    provider: 'Singtel',
    flagUrl: '/flags/sg.svg',
  },
};

