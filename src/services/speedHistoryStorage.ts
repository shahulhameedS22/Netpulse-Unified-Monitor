/**
 * Persistent Multi-Device Session Storage for Speed Test
 *
 * Implements triple-layer resilience:
 * 1. Server Persistence (/api/sessions/speedtest): Available across all browser tabs, devices, copied links, and reloads.
 * 2. Firestore Cloud Backup: Syncs to cloud database for authenticated NOC operators.
 * 3. Client LocalStorage Cache: Provides instant zero-latency UI rendering and offline fallback.
 *
 * 100% free with minimal storage footprint.
 */

import { type SpeedTestSession } from '../types/speedSession';
import { formatSessionDateTime, FormattedDateTime } from './pingHistoryStorage';
import { db, auth } from '../lib/firebase';
import { doc, setDoc, deleteDoc, getDocs, collection, query, orderBy, limit } from 'firebase/firestore';

export { formatSessionDateTime, type FormattedDateTime };

const STORAGE_KEY = 'noc_speedtest_sessions_history_v1';
const MAX_STORED_SESSIONS = 100;

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

function saveToLocalStorage(sessions: SpeedTestSession[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const trimmed = sessions.slice(0, MAX_STORED_SESSIONS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('Failed to save speed sessions to localStorage:', err);
  }
}

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

export async function fetchServerSpeedSessions(): Promise<SpeedTestSession[]> {
  try {
    const res = await fetch('/api/sessions/speedtest', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data && Array.isArray(data.sessions)) {
      return data.sessions;
    }
  } catch (err) {
    console.warn('[SpeedSessionStorage] Server fetch skipped or offline:', err);
  }
  return [];
}

export async function fetchFirestoreSpeedSessions(): Promise<SpeedTestSession[]> {
  try {
    if (!auth.currentUser) return [];
    const q = query(collection(db, 'speedtest_sessions'), orderBy('startedAt', 'desc'), limit(50));
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
    console.warn('[SpeedSessionStorage] Firestore fetch skipped:', err);
    return [];
  }
}

export async function loadAllSpeedSessions(): Promise<SpeedTestSession[]> {
  const local = loadStoredSpeedSessions();

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

export async function persistSpeedSession(newSession: SpeedTestSession): Promise<SpeedTestSession[]> {
  // 1. Local update
  const currentLocal = loadStoredSpeedSessions();
  const updatedLocal = mergeSessions([newSession], currentLocal);
  saveToLocalStorage(updatedLocal);

  // 2. Server API update
  fetch('/api/sessions/speedtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: newSession }),
  }).catch((err) => {
    console.warn('[SpeedSessionStorage] Failed to push session to server API:', err);
  });

  // 3. Firestore update
  if (auth.currentUser) {
    try {
      const sessionDocRef = doc(db, 'speedtest_sessions', newSession.id);
      const firestorePayload = {
        id: newSession.id,
        startedAt: newSession.startedAt,
        completedAt: newSession.completedAt || new Date().toISOString(),
        regions: newSession.regions || {},
        summary: newSession.summary || null,
      };
      setDoc(sessionDocRef, firestorePayload).catch((err) => {
        console.warn('[SpeedSessionStorage] Firestore doc write skipped:', err);
      });
    } catch (err) {
      console.warn('[SpeedSessionStorage] Firestore sync error:', err);
    }
  }

  return updatedLocal;
}

export async function removeSpeedSession(sessionId: string): Promise<SpeedTestSession[]> {
  const current = loadStoredSpeedSessions();
  const updated = current.filter((s) => s.id !== sessionId);
  saveToLocalStorage(updated);

  fetch(`/api/sessions/speedtest/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  }).catch(() => {});

  if (auth.currentUser) {
    try {
      deleteDoc(doc(db, 'speedtest_sessions', sessionId)).catch(() => {});
    } catch {}
  }

  return updated;
}

export async function clearAllSpeedSessions(): Promise<void> {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  fetch('/api/sessions/speedtest', {
    method: 'DELETE',
  }).catch(() => {});
}
