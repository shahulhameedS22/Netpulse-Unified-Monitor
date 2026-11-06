/**
 * Persistent Multi-Device Session Storage for Speed Tests
 *
 * Implements triple-layer resilience:
 * 1. Server Persistence (/api/sessions/speed): Available across all browser tabs, devices, copied links, and page refreshes.
 * 2. Firestore Cloud Backup: Syncs to cloud database for authenticated NOC operators.
 * 3. Client LocalStorage Cache: Provides instant zero-latency UI rendering and offline fallback.
 *
 * Deleting a session (or clearing the history) removes it from ALL three layers. If one layer cannot be
 * cleared, the functions below throw an error instead of pretending it worked, because the sessions that
 * remain would come back after a refresh.
 *
 * Designed to be 100% free with minimal storage footprint.
 */

import { type SpeedTestSession } from '../types/speedSession';
import { reportSessionToMonitoring } from './monitoringApi';
import { db, auth } from '../lib/firebase';
import { doc, setDoc, deleteDoc, getDocs, collection, query, orderBy, limit } from 'firebase/firestore';

const STORAGE_KEY = 'noc_speed_sessions_history_v1';
const SERVER_URL = '/api/sessions/speed';
const FIRESTORE_COLLECTION = 'speedtest_sessions';
const MAX_STORED_SESSIONS = 100;

/**
 * Writes that are still in flight (server / Firestore). Clearing waits for them, so a session that was
 * saved a moment before "Clear All" cannot arrive afterwards and reappear.
 */
const pendingWrites = new Set<Promise<unknown>>();
function trackWrite<T>(p: Promise<T>): Promise<T> {
  pendingWrites.add(p);
  const done = () => {
    pendingWrites.delete(p);
  };
  p.then(done, done);
  return p;
}
async function waitForPendingWrites(): Promise<void> {
  if (pendingWrites.size > 0) {
    await Promise.allSettled([...pendingWrites]);
  }
}

/**
 * Synchronous local storage read for instantaneous component mounting
 */
export function loadStoredSpeedSessions(): SpeedTestSession[] {
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
    console.warn('Failed to parse stored speed sessions from localStorage:', err);
    return [];
  }
}

/**
 * Save to localStorage cache
 */
function saveToLocalStorage(sessions: SpeedTestSession[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const trimmed = sessions.slice(0, MAX_STORED_SESSIONS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('Failed to save sessions to localStorage:', err);
  }
}

/**
 * Merge two lists of sessions by ID, newest first
 */
function mergeSessions(primary: SpeedTestSession[], secondary: SpeedTestSession[]): SpeedTestSession[] {
  const map = new Map<string, SpeedTestSession>();
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
 * Fetch sessions from the server API (/api/sessions/speed)
 * Guarantees that any device/tab opening the link gets all past sessions.
 */
export async function fetchServerSpeedSessions(): Promise<SpeedTestSession[]> {
  try {
    const res = await fetch(SERVER_URL, {
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
export async function fetchFirestoreSpeedSessions(): Promise<SpeedTestSession[]> {
  try {
    if (!auth.currentUser) return [];
    const q = query(collection(db, FIRESTORE_COLLECTION), orderBy('startedAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    const sessions: SpeedTestSession[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.id && data.startedAt) {
        sessions.push(data as SpeedTestSession);
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
export async function loadAllSpeedSessions(): Promise<SpeedTestSession[]> {
  const local = loadStoredSpeedSessions();

  // Concurrently query Server and Firestore
  const [serverSessions, firestoreSessions] = await Promise.all([
    fetchServerSpeedSessions(),
    fetchFirestoreSpeedSessions(),
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
export async function persistSpeedSession(newSession: SpeedTestSession): Promise<SpeedTestSession[]> {
  // 1. Local update
  const currentLocal = loadStoredSpeedSessions();
  const updatedLocal = mergeSessions([newSession], currentLocal);
  saveToLocalStorage(updatedLocal);

  // Long-term history + anomaly detection (server side). Never blocks or breaks the test.
  void reportSessionToMonitoring('speed', newSession);

  // 2. Server API update (non-blocking, but tracked so that "Clear All" waits for it)
  trackWrite(
    fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: newSession }),
    }).catch((err) => {
      console.warn('[SessionStorage] Failed to push session to server API:', err);
    })
  );

  // 3. Firestore update if authenticated
  if (auth.currentUser) {
    try {
      const sessionDocRef = doc(db, FIRESTORE_COLLECTION, newSession.id);
      // Clean payload for Firestore
      const firestorePayload = {
        id: newSession.id,
        startedAt: newSession.startedAt,
        completedAt: newSession.completedAt || new Date().toISOString(),
        regions: newSession.regions || {},
        summary: newSession.summary || null,
      };
      trackWrite(
        setDoc(sessionDocRef, firestorePayload).catch((err) => {
          console.warn('[SessionStorage] Firestore doc write skipped:', err);
        })
      );
    } catch (err) {
      console.warn('[SessionStorage] Firestore sync error:', err);
    }
  }

  return updatedLocal;
}

/* ------------------------------------------------------------------ */
/* Deleting                                                             */
/* ------------------------------------------------------------------ */

/** Server delete. "No such route" (404/405) means this deployment has no server store, which is fine. */
async function deleteOnServer(url: string): Promise<void> {
  try {
    const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(8000) });
    if (res.ok || res.status === 404 || res.status === 405) return;
    throw new Error(`the server answered HTTP ${res.status}`);
  } catch (err: any) {
    // Server unreachable: nothing could have been loaded from it either, so it is not a reason to fail.
    if (err instanceof TypeError || err?.name === 'AbortError' || err?.name === 'TimeoutError') return;
    throw err;
  }
}

function describeFirestoreError(err: any): string {
  if (err?.code === 'permission-denied') {
    return 'Firebase refused the delete (permission denied). Publish the latest firestore.rules in the Firebase Console.';
  }
  return err?.message || String(err);
}

/** Deletes every document of a Firestore collection, in small rounds, and checks that nothing is left. */
async function deleteAllFirestoreDocs(collectionName: string): Promise<void> {
  for (let round = 0; round < 50; round++) {
    const snap = await getDocs(query(collection(db, collectionName), limit(100)));
    if (snap.empty) return;
    const results = await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
    const deleted = results.filter((r) => r.status === 'fulfilled').length;
    if (deleted === 0) {
      const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(describeFirestoreError(firstError?.reason));
    }
  }
  const left = await getDocs(query(collection(db, collectionName), limit(1)));
  if (!left.empty) throw new Error('some sessions could not be deleted from Firestore');
}

/**
 * Delete a session across LocalStorage, Server API, and Firestore.
 * Throws if it could not be removed everywhere (the caller should then keep showing it).
 */
export async function removeSpeedSession(sessionId: string): Promise<SpeedTestSession[]> {
  await waitForPendingWrites();
  const problems: string[] = [];

  try {
    await deleteOnServer(`${SERVER_URL}/${encodeURIComponent(sessionId)}`);
  } catch (err: any) {
    problems.push(`server: ${err?.message || err}`);
  }

  if (auth.currentUser) {
    try {
      await deleteDoc(doc(db, FIRESTORE_COLLECTION, sessionId));
    } catch (err: any) {
      problems.push(describeFirestoreError(err));
    }
  }

  if (problems.length > 0) {
    throw new Error(`The session could not be deleted everywhere (${problems.join('; ')}).`);
  }

  const updated = loadStoredSpeedSessions().filter((s) => s.id !== sessionId);
  saveToLocalStorage(updated);
  return updated;
}

/**
 * Clear all sessions across LocalStorage, Server API, and Firestore.
 * Throws if something could not be cleared (the sessions that remain would come back after a refresh).
 */
export async function clearAllSpeedSessions(): Promise<void> {
  await waitForPendingWrites();
  const problems: string[] = [];

  try {
    await deleteOnServer(SERVER_URL);
  } catch (err: any) {
    problems.push(`server: ${err?.message || err}`);
  }

  if (auth.currentUser) {
    try {
      await deleteAllFirestoreDocs(FIRESTORE_COLLECTION);
    } catch (err: any) {
      problems.push(describeFirestoreError(err));
    }
  }

  if (problems.length > 0) {
    throw new Error(`The session history could not be fully cleared (${problems.join('; ')}).`);
  }

  // Only when everything remote is gone: clear the local cache too.
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
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
