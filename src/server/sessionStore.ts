/**
 * Server-Side Persistent Storage for Ping & Speed Test Sessions
 *
 * Keeps historical sessions across browser refreshes, shared links, and multi-user access:
 * - Persists sessions to disk in `./data/ping_sessions.json` and `./data/speedtest_sessions.json`
 * - Caches up to 100 recent sessions in memory for instant API responses
 * - Compacts older sessions to ensure minimal memory footprint and zero disk bloat.
 */

import fs from 'fs';
import path from 'path';

export interface CompactPingSession {
  id: string;
  startedAt: string;
  completedAt?: string;
  targetIp: string;
  pingCount: number;
  regions: Record<string, any>;
  summary: any;
}

export interface CompactSpeedSession {
  id: string;
  startedAt: string;
  completedAt?: string;
  regions: Record<string, any>;
  summary: any;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PING_DATA_FILE = path.join(DATA_DIR, 'ping_sessions.json');
const SPEED_DATA_FILE = path.join(DATA_DIR, 'speedtest_sessions.json');
const MAX_SESSIONS = 100;

let pingMemorySessions: CompactPingSession[] = [];
let speedMemorySessions: CompactSpeedSession[] = [];
let pingInitialized = false;
let speedInitialized = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
      console.warn('[SessionStore] Could not create data directory:', e);
    }
  }
}

// ----------------- PING SESSIONS -----------------

function loadPingFromDisk(): CompactPingSession[] {
  try {
    ensureDataDir();
    if (fs.existsSync(PING_DATA_FILE)) {
      const raw = fs.readFileSync(PING_DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s) => s && s.id && s.startedAt)
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      }
    }
  } catch (err) {
    console.warn('[SessionStore] Failed to read ping sessions from disk:', err);
  }
  return [];
}

function savePingToDisk(sessions: CompactPingSession[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(PING_DATA_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[SessionStore] Failed to persist ping sessions to disk:', err);
  }
}

function compactPingSession(s: any, isRecent: boolean): CompactPingSession {
  if (!s || typeof s !== 'object') return s;
  if (isRecent) return s;

  const compactedRegions: Record<string, any> = {};
  if (s.regions && typeof s.regions === 'object') {
    for (const [rid, res] of Object.entries(s.regions)) {
      const r = res as any;
      compactedRegions[rid] = {
        ...r,
        packets: [],
      };
    }
  }

  return {
    ...s,
    regions: compactedRegions,
  };
}

export function getAllSessions(): CompactPingSession[] {
  if (!pingInitialized) {
    pingMemorySessions = loadPingFromDisk();
    pingInitialized = true;
  }
  return [...pingMemorySessions];
}

export function addSession(newSession: any): CompactPingSession[] {
  if (!pingInitialized) {
    pingMemorySessions = loadPingFromDisk();
    pingInitialized = true;
  }

  if (!newSession || !newSession.id) {
    return pingMemorySessions;
  }

  const filtered = pingMemorySessions.filter((s) => s.id !== newSession.id);
  const combined = [newSession, ...filtered];
  const trimmed = combined.slice(0, MAX_SESSIONS).map((s, idx) => compactPingSession(s, idx < 20));
  pingMemorySessions = trimmed;

  savePingToDisk(pingMemorySessions);
  return [...pingMemorySessions];
}

export function deleteSession(sessionId: string): CompactPingSession[] {
  if (!pingInitialized) {
    pingMemorySessions = loadPingFromDisk();
    pingInitialized = true;
  }

  pingMemorySessions = pingMemorySessions.filter((s) => s.id !== sessionId);
  savePingToDisk(pingMemorySessions);
  return [...pingMemorySessions];
}

export function clearSessions(): void {
  pingMemorySessions = [];
  pingInitialized = true;
  savePingToDisk(pingMemorySessions);
}

// ----------------- SPEED TEST SESSIONS -----------------

function loadSpeedFromDisk(): CompactSpeedSession[] {
  try {
    ensureDataDir();
    if (fs.existsSync(SPEED_DATA_FILE)) {
      const raw = fs.readFileSync(SPEED_DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s) => s && s.id && s.startedAt)
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      }
    }
  } catch (err) {
    console.warn('[SessionStore] Failed to read speed sessions from disk:', err);
  }
  return [];
}

function saveSpeedToDisk(sessions: CompactSpeedSession[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(SPEED_DATA_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[SessionStore] Failed to persist speed sessions to disk:', err);
  }
}

export function getAllSpeedSessions(): CompactSpeedSession[] {
  if (!speedInitialized) {
    speedMemorySessions = loadSpeedFromDisk();
    speedInitialized = true;
  }
  return [...speedMemorySessions];
}

export function addSpeedSession(newSession: any): CompactSpeedSession[] {
  if (!speedInitialized) {
    speedMemorySessions = loadSpeedFromDisk();
    speedInitialized = true;
  }

  if (!newSession || !newSession.id) {
    return speedMemorySessions;
  }

  const filtered = speedMemorySessions.filter((s) => s.id !== newSession.id);
  const combined = [newSession, ...filtered];
  const trimmed = combined.slice(0, MAX_SESSIONS);
  speedMemorySessions = trimmed;

  saveSpeedToDisk(speedMemorySessions);
  return [...speedMemorySessions];
}

export function deleteSpeedSession(sessionId: string): CompactSpeedSession[] {
  if (!speedInitialized) {
    speedMemorySessions = loadSpeedFromDisk();
    speedInitialized = true;
  }

  speedMemorySessions = speedMemorySessions.filter((s) => s.id !== sessionId);
  saveSpeedToDisk(speedMemorySessions);
  return [...speedMemorySessions];
}

export function clearSpeedSessions(): void {
  speedMemorySessions = [];
  speedInitialized = true;
  saveSpeedToDisk(speedMemorySessions);
}
