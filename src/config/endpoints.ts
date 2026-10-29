/**
 * Unified Network Endpoints Configuration
 * 
 * Centralized definition for the four authorized regional data center nodes:
 * 1. IN-DC01 — Bangalore TATA (https://in-dc01.trainocate.com:8443)
 * 2. IN-DC02 — Bangalore ACT  (https://in-dc02.trainocate.com:8443)
 * 3. LK-DC01 — Sri Lanka      (https://lk-dc01.trainocate.com:8443)
 * 4. SG-DC01 — Singapore      (https://sg-dc01.trainocate.com:8443)
 */

export interface UnifiedEndpoint {
  id: string;
  serverCode: 'IN-DC01' | 'IN-DC02' | 'LK-DC01' | 'SG-DC01';
  name: string;
  fullName: string;
  location: string;
  country: string;
  countryCode: 'IN' | 'SL' | 'SG';
  provider: string;
  coordinates: string;
  accentColor: string;
  flagUrl: string;
  description: string;
  baseUrl: string;
  pingUrl: string;
  downloadUrl: string;
  uploadUrl: string;
}

export const UNIFIED_ENDPOINTS: UnifiedEndpoint[] = [
  {
    id: 'in-dc01',
    serverCode: 'IN-DC01',
    name: 'India',
    fullName: 'Bangalore Data Center',
    location: 'Bangalore, Karnataka',
    country: 'India',
    countryCode: 'IN',
    provider: 'TATA Node',
    coordinates: '12.972171° N, 77.607798° E',
    accentColor: '#06B6D4',
    flagUrl: '/flags/in.svg',
    description: 'Bangalore Data Center (Port 8443)',
    baseUrl: 'https://in-dc01.trainocate.com:8443/backend/',
    pingUrl: 'https://in-dc01.trainocate.com:8443/backend/empty.php',
    downloadUrl: 'https://in-dc01.trainocate.com:8443/backend/garbage.php',
    uploadUrl: 'https://in-dc01.trainocate.com:8443/backend/empty.php',
  },
  {
    id: 'in-dc02',
    serverCode: 'IN-DC02',
    name: 'India',
    fullName: 'Bangalore Data Center',
    location: 'Bangalore, Karnataka',
    country: 'India',
    countryCode: 'IN',
    provider: 'ACT Node',
    coordinates: '12.972171° N, 77.607798° E',
    accentColor: '#3B82F6',
    flagUrl: '/flags/in.svg',
    description: 'Bangalore Data Center (Port 8443)',
    baseUrl: 'https://in-dc02.trainocate.com:8443/backend/',
    pingUrl: 'https://in-dc02.trainocate.com:8443/backend/empty.php',
    downloadUrl: 'https://in-dc02.trainocate.com:8443/backend/garbage.php',
    uploadUrl: 'https://in-dc02.trainocate.com:8443/backend/empty.php',
  },
  {
    id: 'lk-dc01',
    serverCode: 'LK-DC01',
    name: 'Sri Lanka',
    fullName: 'Sri Lanka Data Center',
    location: 'Colombo, Srilanka',
    country: 'Sri Lanka',
    countryCode: 'SL',
    provider: 'SLT-Mobitel',
    coordinates: '6.864023° N, 79.863291° E',
    accentColor: '#10B981',
    flagUrl: '/flags/lk.svg',
    description: 'Sri Lanka Data Center (Port 8443)',
    baseUrl: 'https://lk-dc01.trainocate.com:8443/backend/',
    pingUrl: 'https://lk-dc01.trainocate.com:8443/backend/empty.php',
    downloadUrl: 'https://lk-dc01.trainocate.com:8443/backend/garbage.php',
    uploadUrl: 'https://lk-dc01.trainocate.com:8443/backend/empty.php',
  },
  {
    id: 'sg-dc01',
    serverCode: 'SG-DC01',
    name: 'Singapore',
    fullName: 'Singapore Data Center',
    location: 'Middle Road, Singpore',
    country: 'Singapore',
    countryCode: 'SG',
    provider: 'Singtel',
    coordinates: '1.300299° N, 103.852279° E',
    accentColor: '#6366F1',
    flagUrl: '/flags/sg.svg',
    description: 'Singapore Data Center (Port 8443)',
    baseUrl: 'https://sg-dc01.trainocate.com:8443/backend/',
    pingUrl: 'https://sg-dc01.trainocate.com:8443/backend/empty.php',
    downloadUrl: 'https://sg-dc01.trainocate.com:8443/backend/garbage.php',
    uploadUrl: 'https://sg-dc01.trainocate.com:8443/backend/empty.php',
  },
];

// Alias for backwards compatibility with speed test engine
export type TestEndpoint = UnifiedEndpoint;
export const TEST_ENDPOINTS = UNIFIED_ENDPOINTS;
