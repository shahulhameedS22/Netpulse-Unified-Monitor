/**
 * Lightweight, 100% Free Persistent Session Storage for Ping Monitoring
 * 
 * Uses localStorage with automatic quota-safe storage trimming:
 * - Stores up to 100 recent sessions permanently across reloads.
 * - Trims large individual packet payload arrays for sessions older than the top 15,
 *   preserving all latency metrics, loss rates, timestamps, and regional summaries.
 * - Total browser storage footprint stays under ~60-90 KB (well within the free 5-10 MB limit).
 * - Zero cost, zero database server requirements, instant load.
 */

import { type PingSession, type RegionId, type RegionPingResult } from '../types/ping';

const STORAGE_KEY = 'noc_ping_sessions_history_v1';
const MAX_STORED_SESSIONS = 100;
const MAX_DETAILED_PACKETS_SESSIONS = 15;

/**
 * Strips verbose packet arrays from older sessions to keep storage ultra-lightweight and free
 */
function compactSession(session: PingSession, retainFullPackets: boolean): PingSession {
  if (retainFullPackets) {
    return session;
  }

  const compactedRegions: Record<RegionId, RegionPingResult> = { ...session.regions };
  for (const [rid, res] of Object.entries(session.regions || {})) {
    compactedRegions[rid as RegionId] = {
      ...res,
      packets: [],
    };
  }

  return {
    ...session,
    regions: compactedRegions,
  };
}

/**
 * Load all stored ping test sessions from localStorage
 */
export function loadStoredPingSessions(): PingSession[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((s) => s && typeof s === 'object' && s.id && s.startedAt)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch (err) {
    console.warn('Failed to parse stored ping sessions from localStorage:', err);
    return [];
  }
}

/**
 * Save a new ping session into localStorage and return the updated session list
 */
export function savePingSessionToStorage(newSession: PingSession): PingSession[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [newSession];
  }

  try {
    const current = loadStoredPingSessions();
    const filtered = current.filter((s) => s.id !== newSession.id);
    const combined = [newSession, ...filtered];

    const trimmed = combined.slice(0, MAX_STORED_SESSIONS).map((sess, idx) => {
      return compactSession(sess, idx < MAX_DETAILED_PACKETS_SESSIONS);
    });

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch (err) {
    console.warn('Failed to save ping session to localStorage:', err);
    try {
      const current = loadStoredPingSessions();
      const emergencyTrimmed = [newSession, ...current.slice(0, 20)].map((s) => compactSession(s, false));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(emergencyTrimmed));
      return emergencyTrimmed;
    } catch {
      return [newSession];
    }
  }
}

/**
 * Delete a specific session by ID
 */
export function deleteStoredPingSession(sessionId: string): PingSession[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const current = loadStoredPingSessions();
    const updated = current.filter((s) => s.id !== sessionId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn('Failed to delete ping session:', err);
    return [];
  }
}

/**
 * Clear all stored ping sessions
 */
export function clearAllStoredPingSessions(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear stored ping sessions:', err);
  }
}

export interface FormattedDateTime {
  dateFull: string;
  dateShort: string;
  timeWithSeconds: string;
  timeShort: string;
  relative: string;
  epochMs: number;
}

/**
 * Format ISO string into crisp, highly legible date and time representations
 */
export function formatSessionDateTime(isoString: string): FormattedDateTime {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) {
      throw new Error('Invalid date');
    }

    const dateFull = d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const dateShort = d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const timeWithSeconds = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    const timeShort = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);

    let relative = 'Just now';
    if (diffSec < 45) {
      relative = 'Just now';
    } else if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      relative = `${mins} min${mins > 1 ? 's' : ''} ago`;
    } else if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      relative = `${hours} hr${hours > 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffSec / 86400);
      relative = `${days} day${days > 1 ? 's' : ''} ago`;
    }

    return {
      dateFull,
      dateShort,
      timeWithSeconds,
      timeShort,
      relative,
      epochMs: d.getTime(),
    };
  } catch {
    return {
      dateFull: isoString,
      dateShort: isoString,
      timeWithSeconds: isoString,
      timeShort: isoString,
      relative: 'Recorded',
      epochMs: 0,
    };
  }
}
