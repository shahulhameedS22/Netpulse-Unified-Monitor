/**
 * Server-Side Persistent Storage for Ping Test Sessions
 *
 * Keeps historical sessions across browser refreshes, shared links, and multi-user access:
 * - Persists sessions to disk in `./data/ping_sessions.json`
 * - Caches up to 100 recent sessions in memory for instant API responses
 * - Automatically compacts older sessions (pruning detailed packet logs for items older than 20)
 *   to ensure zero storage bloat and zero memory impact.
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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'ping_sessions.json');
const MAX_SESSIONS = 100;

let memorySessions: CompactPingSession[] = [];
let initialized = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
      console.warn('[SessionStore] Could not create data directory:', e);
    }
  }
}

function loadFromDisk(): CompactPingSession[] {
  try {
    ensureDataDir();
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s) => s && s.id && s.startedAt)
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      }
    }
  } catch (err) {
    console.warn('[SessionStore] Failed to read sessions from disk:', err);
  }
  return [];
}

function saveToDisk(sessions: CompactPingSession[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[SessionStore] Failed to persist sessions to disk:', err);
  }
}

function compactSession(s: any, isRecent: boolean): CompactPingSession {
  if (!s || typeof s !== 'object') return s;
  if (isRecent) return s;

  // Prune detailed packet timestamps for older sessions to conserve memory
  const compactedRegions: Record<string, any> = {};
  if (s.regions && typeof s.regions === 'object') {
    for (const [rid, res] of Object.entries(s.regions)) {
      const r = res as any;
      compactedRegions[rid] = {
        ...r,
        packets: [], // Compact packet array for older sessions
      };
    }
  }

  return {
    ...s,
    regions: compactedRegions,
  };
}

export function getAllSessions(): CompactPingSession[] {
  if (!initialized) {
    memorySessions = loadFromDisk();
    initialized = true;
  }
  return [...memorySessions];
}

export function addSession(newSession: any): CompactPingSession[] {
  if (!initialized) {
    memorySessions = loadFromDisk();
    initialized = true;
  }

  if (!newSession || !newSession.id) {
    return memorySessions;
  }

  // Remove existing duplicate if re-saving
  const filtered = memorySessions.filter((s) => s.id !== newSession.id);
  const combined = [newSession, ...filtered];

  // Keep up to MAX_SESSIONS and compact older than 20
  const trimmed = combined.slice(0, MAX_SESSIONS).map((s, idx) => compactSession(s, idx < 20));
  memorySessions = trimmed;

  saveToDisk(memorySessions);
  return [...memorySessions];
}

export function deleteSession(sessionId: string): CompactPingSession[] {
  if (!initialized) {
    memorySessions = loadFromDisk();
    initialized = true;
  }

  memorySessions = memorySessions.filter((s) => s.id !== sessionId);
  saveToDisk(memorySessions);
  return [...memorySessions];
}

export function clearSessions(): void {
  memorySessions = [];
  initialized = true;
  saveToDisk(memorySessions);
}
