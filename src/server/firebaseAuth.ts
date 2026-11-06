/**
 * Verify Firebase Authentication ID tokens on protected monitoring APIs.
 * Public keys are cached in-process; no user data is trusted from the request body.
 */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string; use?: string };
let keyCache: { keys: Map<string, crypto.KeyObject>; expiresAt: number } | null = null;

async function signingKeys(): Promise<Map<string, crypto.KeyObject>> {
  if (keyCache && keyCache.expiresAt > Date.now()) return keyCache.keys;
  const response = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('FIREBASE_SIGNING_KEYS_UNAVAILABLE');
  const data: any = await response.json();
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of (data.keys || []) as Jwk[]) {
    if (jwk.kid && jwk.kty === 'RSA') keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as any, format: 'jwk' }));
  }
  if (!keys.size) throw new Error('FIREBASE_SIGNING_KEYS_EMPTY');
  keyCache = { keys, expiresAt: Date.now() + 50 * 60_000 };
  return keys;
}

export interface FirebaseIdentity {
  uid: string;
  email?: string;
}

export async function verifyFirebaseIdToken(token: string): Promise<FirebaseIdentity | null> {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID_NOT_CONFIGURED');
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: any;
  let claims: any;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof claims.sub !== 'string' || !claims.sub ||
    claims.sub.length > 128 ||
    typeof claims.exp !== 'number' || claims.exp <= now ||
    typeof claims.iat !== 'number' || claims.iat > now + 60 ||
    claims.exp - claims.iat > 3600
  ) return null;

  const keys = await signingKeys();
  const key = keys.get(header.kid);
  if (!key) {
    keyCache = null;
    const refreshed = await signingKeys();
    const newKey = refreshed.get(header.kid);
    if (!newKey) return null;
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), newKey, signature)) return null;
  } else {
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) return null;
  }

  return { uid: claims.sub, ...(typeof claims.email === 'string' ? { email: claims.email } : {}) };
}

export async function firebaseAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers['x-firebase-auth'];
  const token = typeof header === 'string' ? header.trim() : '';
  if (!token || token.length > 5000) {
    res.status(401).json({ ok: false, error: 'Firebase sign-in is required.', code: 'FIREBASE_AUTH_REQUIRED' });
    return;
  }
  try {
    const identity = await verifyFirebaseIdToken(token);
    if (!identity) {
      res.status(401).json({ ok: false, error: 'Firebase session is invalid or expired. Please sign in again.', code: 'FIREBASE_TOKEN_INVALID' });
      return;
    }
    (req as any).firebaseUser = identity;
    next();
  } catch (error: any) {
    console.error('[firebase-auth]', error?.message || error);
    res.status(503).json({ ok: false, error: 'Authentication verification is temporarily unavailable.' });
  }
}
