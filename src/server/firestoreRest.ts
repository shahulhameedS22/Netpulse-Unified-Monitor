/**
 * Minimal Firestore REST client for server-side monitoring history.
 * Uses a service-account JWT; no extra runtime dependency is required.
 * The service account is server-only and must never use a VITE_ variable.
 */
import crypto from 'node:crypto';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let cachedToken: { value: string; expiresAt: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
      || (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
        ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
        : '');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return { ...parsed, private_key: String(parsed.private_key).replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export function isFirestoreConfigured(): boolean {
  return Boolean(serviceAccount());
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = serviceAccount();
  if (!account) throw new Error('FIRESTORE_SERVICE_ACCOUNT_NOT_CONFIGURED');

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${b64url(signer.sign(account.private_key))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(`FIRESTORE_TOKEN_ERROR_${response.status}`);
  }
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

function databaseBase(): string {
  const account = serviceAccount();
  if (!account) throw new Error('FIRESTORE_SERVICE_ACCOUNT_NOT_CONFIGURED');
  const project = process.env.FIREBASE_PROJECT_ID?.trim() || account.project_id;
  const database = process.env.FIREBASE_DATABASE_ID?.trim()
    || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID?.trim()
    || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/${encodeURIComponent(database)}/documents`;
}

async function firestoreFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken();
  const response = await fetch(`${databaseBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(12_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`FIRESTORE_HTTP_${response.status}: ${detail.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function toFirestoreValue(value: any): any {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_FIRESTORE_VALUE');
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'object') {
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    const fields: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) fields[key] = toFirestoreValue(child);
    return { mapValue: { fields } };
  }
  throw new Error('UNSUPPORTED_FIRESTORE_VALUE');
}

function fromFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)]));
}

function safeDocId(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex');
}

export async function firestoreSet(collectionId: string, id: string, data: Record<string, any>): Promise<void> {
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
  const docId = safeDocId(id);
  await firestoreFetch(`/${encodeURIComponent(collectionId)}/${docId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

export async function firestoreRange(
  collectionId: string,
  from: number,
  to: number,
  limit: number,
): Promise<any[]> {
  const response = await firestoreFetch(':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 't' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(Math.floor(from)) } } },
              { fieldFilter: { field: { fieldPath: 't' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(Math.floor(to)) } } },
            ],
          },
        },
        orderBy: [{ field: { fieldPath: 't' }, direction: 'DESCENDING' }],
        limit: Math.max(1, Math.min(20_000, Math.floor(limit))),
      },
    }),
  });
  if (!Array.isArray(response)) return [];
  return response
    .filter((row: any) => row?.document?.fields)
    .map((row: any) => fromFirestoreFields(row.document.fields))
    .reverse();
}


export async function firestoreGet(collectionId: string, id: string): Promise<any | null> {
  const docId = safeDocId(id);
  const response = await firestoreFetch(`/${encodeURIComponent(collectionId)}/${docId}`);
  return response?.fields ? fromFirestoreFields(response.fields) : null;
}

export async function firestoreCreate(collectionId: string, id: string, data: Record<string, any>): Promise<void> {
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]));
  const docId = safeDocId(id);
  try {
    await firestoreFetch(`/${encodeURIComponent(collectionId)}/${docId}?currentDocument.exists=false`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
  } catch (error: any) {
    if (String(error?.message || '').includes('FIRESTORE_HTTP_409')) throw new Error('FIRESTORE_DOCUMENT_ALREADY_EXISTS');
    throw error;
  }
}

export async function firestoreDelete(collectionId: string, id: string): Promise<void> {
  const docId = safeDocId(id);
  await firestoreFetch(`/${encodeURIComponent(collectionId)}/${docId}`, { method: 'DELETE' });
}
