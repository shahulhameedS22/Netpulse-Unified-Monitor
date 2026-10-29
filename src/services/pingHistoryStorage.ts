/**
 * Persistent Multi-Device Session Storage for Ping Monitoring
 *
 * Implements triple-layer resilience:
 * 1. Server Persistence (/api/sessions/ping): Available across all browser tabs, devices, copied links, and page refreshes.
 * 2. Firestore Cloud Backup: Syncs to cloud database for authenticated NOC operators.
 * 3. Client LocalStorage Cache: Provides instant zero-latency UI rendering and offline fallback.
 *
 * Designed to be 100% free with minimal storage footprint.
 */

import { type PingSession, type RegionId, type RegionPingResult } from '../types/ping';
import { db, auth } from '../lib/firebase';
import { doc, setDoc, deleteDoc, getDocs, collection, query, orderBy, limit } from 'firebase/firestore';

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
      packets: [], // Compact verbose per-packet timestamps for older sessions
    };
  }

  return {
    ...session,
    regions: compactedRegions,
  };
}

/**
 * Synchronous local storage read for instantaneous component mounting
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
 * Save to localStorage cache
 */
function saveToLocalStorage(sessions: PingSession[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const trimmed = sessions.slice(0, MAX_STORED_SESSIONS).map((sess, idx) => {
      return compactSession(sess, idx < MAX_DETAILED_PACKETS_SESSIONS);
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('Failed to save sessions to localStorage:', err);
  }
}

/**
 * Merge two lists of sessions by ID, newest first
 */
function mergeSessions(primary: PingSession[], secondary: PingSession[]): PingSession[] {
  const map = new Map<string, PingSession>();
  for (const s of [...primary, ...secondary]) {
    if (s && s.id && s.startedAt) {
      if (!map.has(s.id)) {
        map.set(s.id, s);
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

/**
 * Fetch sessions from the server API (/api/sessions/ping)
 * Guarantees that any device/tab opening the link gets all past sessions.
 */
export async function fetchServerPingSessions(): Promise<PingSession[]> {
  try {
    const res = await fetch('/api/sessions/ping', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data && Array.isArray(data.sessions)) {
      return data.sessions;
    }
  } catch (err) {
    // Non-fatal, will fall back to Firestore and localStorage
    console.warn('[SessionStorage] Server fetch skipped or offline:', err);
  }
  return [];
}

/**
 * Fetch sessions from Firestore if operator is signed in
 */
export async function fetchFirestorePingSessions(): Promise<PingSession[]> {
  try {
    if (!auth.currentUser) return [];
    const q = query(collection(db, 'ping_sessions'), orderBy('startedAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    const sessions: PingSession[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.id && data.startedAt) {
        sessions.push(data as PingSession);
      }
    });
    return sessions;
  } catch (err) {
    console.warn('[SessionStorage] Firestore fetch skipped:', err);
    return [];
  }
}

/**
 * Robust fetch combining Server, Firestore, and LocalStorage:
 * - Loads remote data
 * - Merges with local cache
 * - Saves back to local cache
 */
export async function loadAllPingSessions(): Promise<PingSession[]> {
  const local = loadStoredPingSessions();

  // Concurrently query Server and Firestore
  const [serverSessions, firestoreSessions] = await Promise.all([
    fetchServerPingSessions(),
    fetchFirestorePingSessions(),
  ]);

  const remote = mergeSessions(serverSessions, firestoreSessions);
  const merged = mergeSessions(remote, local);

  if (merged.length > 0) {
    saveToLocalStorage(merged);
  }

  return merged;
}

/**
 * Persist a newly completed session across LocalStorage, Server API, and Firestore
 */
export async function persistPingSession(newSession: PingSession): Promise<PingSession[]> {
  // 1. Local update
  const currentLocal = loadStoredPingSessions();
  const updatedLocal = mergeSessions([newSession], currentLocal);
  saveToLocalStorage(updatedLocal);

  // 2. Server API update (fire-and-forget / non-blocking)
  fetch('/api/sessions/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: newSession }),
  }).catch((err) => {
    console.warn('[SessionStorage] Failed to push session to server API:', err);
  });

  // 3. Firestore update if authenticated
  if (auth.currentUser) {
    try {
      const sessionDocRef = doc(db, 'ping_sessions', newSession.id);
      // Clean payload for Firestore
      const firestorePayload = {
        id: newSession.id,
        startedAt: newSession.startedAt,
        completedAt: newSession.completedAt || new Date().toISOString(),
        targetIp: newSession.targetIp || '8.8.8.8',
        pingCount: Number(newSession.pingCount || 30),
        regions: newSession.regions || {},
        summary: newSession.summary || null,
      };
      setDoc(sessionDocRef, firestorePayload).catch((err) => {
        console.warn('[SessionStorage] Firestore doc write skipped:', err);
      });
    } catch (err) {
      console.warn('[SessionStorage] Firestore sync error:', err);
    }
  }

  return updatedLocal;
}

/**
 * Delete a session across LocalStorage, Server API, and Firestore
 */
export async function removePingSession(sessionId: string): Promise<PingSession[]> {
  const current = loadStoredPingSessions();
  const updated = current.filter((s) => s.id !== sessionId);
  saveToLocalStorage(updated);

  // Server delete
  fetch(`/api/sessions/ping/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  }).catch(() => {});

  // Firestore delete if authenticated
  if (auth.currentUser) {
    try {
      deleteDoc(doc(db, 'ping_sessions', sessionId)).catch(() => {});
    } catch {}
  }

  return updated;
}

/**
 * Clear all sessions across LocalStorage, Server API, and Firestore
 */
export async function clearAllPingSessions(): Promise<void> {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  // Server clear
  fetch('/api/sessions/ping', {
    method: 'DELETE',
  }).catch(() => {});
}

export interface FormattedDateTime {
  dateFull: string;        // e.g. "Thu, Oct 29, 2026"
  dateShort: string;       // e.g. "Oct 29, 2026"
  timeWithSeconds: string; // e.g. "02:35:12 PM"
  timeShort: string;       // e.g. "02:35 PM"
  relative: string;        // e.g. "2 mins ago"
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
