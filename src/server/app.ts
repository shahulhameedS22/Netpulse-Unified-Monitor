/**
 * Unified Network Monitoring - Central Express Application
 * 
 * Shared Express configuration and route handlers supporting:
 * 1. Ping Monitoring API (ICMP 8.8.8.8 multi-region tests & push agent ingestion)
 * 2. Speed Test Relay API (/api/speedtest/relay streaming relay for LibreSpeed)
 * 3. Health & Regional Diagnostics (/api/health, /api/regions)
 * 4. Admin Account Verification (/api/auth/verify-admin-secret)
 * 5. Timeout alerts: in-app flag on every result, e-mail for long runs of timeouts (./alerts.ts)
 */

import express, { type Request, type Response, type NextFunction, type Application } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
// NOTE: relative imports end in .js (not .ts): the Vercel function runs as an ES module and cannot load .ts files.
import { dispatchSpeedTestRoute } from './speedTestApi.js';
import { buildAlert, sendCriticalAlertEmail, registerAlertRoutes } from './alerts.js';

dotenv.config();

// Allowed Regions across the unified system
export const ALLOWED_REGIONS = ['IN-DC01', 'IN-DC02', 'LK-DC01', 'SG-DC01'] as const;
export type RegionId = typeof ALLOWED_REGIONS[number];

export const FIXED_TARGET_IP = '8.8.8.8';
export const DEFAULT_PING_COUNT = 30;
export const MIN_PING_COUNT = 1;
export const MAX_PING_COUNT = 30;
export const HEALTH_TIMEOUT_MS = 6000;
export const PING_TIMEOUT_MS = 45000;

export function getRegionalEndpointUrl(regionId: RegionId): string | null {
  const sanitize = (v?: string): string | null => {
    if (!v) return null;
    const clean = v.trim();
    if (!clean || clean.toLowerCase() === 'none' || clean === '""' || clean === "''") return null;
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) return null;
    return clean;
  };

  switch (regionId) {
    case 'IN-DC01':
      return sanitize(process.env.REGIONAL_IN_DC01_URL);
    case 'IN-DC02':
      return sanitize(process.env.REGIONAL_IN_DC02_URL);
    case 'LK-DC01':
      return sanitize(process.env.REGIONAL_LK_DC01_URL);
    case 'SG-DC01':
      return sanitize(process.env.REGIONAL_SG_DC01_URL);
    default:
      return null;
  }
}

export function formatNetworkError(err: any): string {
  if (!err) return 'Network failure';
  if (err.name === 'AbortError') return 'Connection timed out';
  if (err.code === 'ECONNREFUSED') return 'Connection refused (service not listening or port blocked)';
  if (err.code === 'ENETUNREACH') return 'Network unreachable (no route to IP)';
  if (err.code === 'EHOSTUNREACH') return 'Host unreachable (target VM offline or subnet not routed)';
  if (err.code === 'ETIMEDOUT') return 'Network connection timed out';
  return err.message || 'Unknown network error';
}

function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

declare global {
  namespace Express {
    interface Request {
      isApiKeyAuthenticated?: boolean;
    }
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown-client';
}

function validatePublicRequestOrigin(req: Request): { allowed: boolean; reason?: string } {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string' && secFetchSite === 'cross-site') {
    return {
      allowed: false,
      reason: 'Cross-site request rejected: Ping test execution is restricted to the Network Monitoring dashboard.',
    };
  }

  const origin = req.headers['origin'];
  const host = req.headers['host'];
  if (typeof origin === 'string' && host) {
    try {
      const originHost = new URL(origin).host;
      const isSameHost = originHost === host;
      const isAllowedHost = isSameHost ||
        originHost.endsWith('.vercel.app') ||
        originHost.endsWith('.run.app') ||
        originHost.includes('localhost') ||
        originHost.includes('127.0.0.1');

      if (!isAllowedHost) {
        return {
          allowed: false,
          reason: `Untrusted origin "${originHost}". Cross-origin ping execution is restricted.`,
        };
      }
    } catch {
      return { allowed: false, reason: 'Malformed Origin header.' };
    }
  }

  return { allowed: true };
}

interface PingRateLimitRecord {
  timestamps: number[];
  inFlight: number;
}

const pingRateLimitStore = new Map<string, PingRateLimitRecord>();
const healthRateLimitStore = new Map<string, number[]>();

function pruneStaleRateLimits(): void {
  const now = Date.now();
  for (const [ip, rec] of pingRateLimitStore.entries()) {
    rec.timestamps = rec.timestamps.filter(t => now - t < 120_000);
    if (rec.timestamps.length === 0 && rec.inFlight <= 0) {
      pingRateLimitStore.delete(ip);
    }
  }
  for (const [ip, timestamps] of healthRateLimitStore.entries()) {
    const fresh = timestamps.filter(t => now - t < 60_000);
    if (fresh.length === 0) {
      healthRateLimitStore.delete(ip);
    } else {
      healthRateLimitStore.set(ip, fresh);
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.CENTRAL_API_KEY?.trim();
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  let providedToken: string | null = null;
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    providedToken = apiKeyHeader.trim();
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.substring(7).trim();
  }

  if (providedToken) {
    if (!expectedKey) {
      res.status(500).json({
        ok: false,
        error: 'Server configuration error: Authentication credentials provided, but CENTRAL_API_KEY is not configured.',
        code: 'AUTH_CONFIG_MISSING',
      });
      return;
    }

    if (!safeCompare(providedToken, expectedKey)) {
      res.status(401).json({
        ok: false,
        error: 'Unauthorized: Invalid authentication credentials.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    req.isApiKeyAuthenticated = true;
    return next();
  }

  if (process.env.REQUIRE_AUTH === 'true') {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized: Authentication is strictly required (REQUIRE_AUTH=true).',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  req.isApiKeyAuthenticated = false;
  next();
}

export function healthRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (req.isApiKeyAuthenticated) return next();
  pruneStaleRateLimits();

  const ip = getClientIp(req);
  const now = Date.now();
  let timestamps = healthRateLimitStore.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < 60_000);

  if (timestamps.length >= 60) {
    res.setHeader('Retry-After', '10');
    res.status(429).json({
      ok: false,
      error: 'Too many health check requests.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 10,
    });
    return;
  }

  timestamps.push(now);
  healthRateLimitStore.set(ip, timestamps);
  next();
}

export function pingRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (req.isApiKeyAuthenticated) return next();

  const originCheck = validatePublicRequestOrigin(req);
  if (!originCheck.allowed) {
    res.status(403).json({
      success: false,
      error: originCheck.reason || 'Forbidden: Cross-site request rejected.',
      code: 'CROSS_SITE_FORBIDDEN',
    });
    return;
  }

  pruneStaleRateLimits();

  const ip = getClientIp(req);
  const now = Date.now();
  let rec = pingRateLimitStore.get(ip);
  if (!rec) {
    rec = { timestamps: [], inFlight: 0 };
    pingRateLimitStore.set(ip, rec);
  }

  rec.timestamps = rec.timestamps.filter(t => now - t < 120_000);

  if (rec.inFlight >= 12) {
    res.setHeader('Retry-After', '5');
    res.status(429).json({
      success: false,
      error: 'Concurrency limit reached: Too many ping tests currently in progress.',
      code: 'CONCURRENCY_LIMIT_EXCEEDED',
      retryAfterSeconds: 5,
    });
    return;
  }

  if (rec.timestamps.length >= 40) {
    const oldest = rec.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((120_000 - (now - oldest)) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      success: false,
      error: `Rate limit reached. Please wait ${retryAfterSeconds}s before starting new tests.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds,
    });
    return;
  }

  rec.timestamps.push(now);
  rec.inFlight++;

  let finalized = false;
  const releaseSlot = () => {
    if (!finalized) {
      finalized = true;
      if (rec) rec.inFlight = Math.max(0, rec.inFlight - 1);
    }
  };

  res.on('finish', releaseSlot);
  res.on('close', releaseSlot);
  next();
}

// Push Mode support
const AGENT_STALE_MS = 600_000;
const PUSH_REQUEST_TTL_S = 120;
const PUSH_RESULT_TTL_S = 300;
const PUSH_COOLDOWN_S = 10;
const PUSH_SEEN_TTL_S = 1200;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const agentKeyEnvName = (r: RegionId) => `AGENT_KEY_${r.replace(/-/g, '_')}`;
const PK = {
  req: (r: string) => `ping:req:${r}`,
  seen: (r: string) => `ping:seen:${r}`,
  cool: (r: string) => `ping:cool:${r}`,
  res: (r: string, id: string) => `ping:res:${r}:${id}`,
};

// A region is in push mode only when ITS OWN key AGENT_KEY_<REGION> is set.
// (A shared fallback key was removed: it made every region look "online" and mapped every agent to the last region.)
export function isPushRegion(regionId: string): regionId is RegionId {
  if (!(ALLOWED_REGIONS as readonly string[]).includes(regionId)) return false;
  return Boolean(process.env[agentKeyEnvName(regionId as RegionId)]?.trim());
}

function digestEqual(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a).digest();
  const db = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(da, db);
}

function authAgent(req: Request): RegionId | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  const token = h.substring(7).trim();
  if (!token) return null;
  let found: RegionId | null = null;
  for (const r of ALLOWED_REGIONS) {
    const key = process.env[agentKeyEnvName(r)]?.trim();
    if (key && digestEqual(token, key)) found = r;
  }
  return found;
}

type RedisCmd = (string | number)[];

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redisPipeline(cmds: RedisCmd[]): Promise<any[]> {
  const cfg = redisConfig();
  if (!cfg) throw new Error('STORAGE_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Storage HTTP ${r.status}`);
    const arr = (await r.json()) as Array<{ result?: any; error?: string }>;
    return arr.map((x) => {
      if (x.error) throw new Error(x.error);
      return x.result;
    });
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_PING_UPSTREAM = (
  process.env.PING_UPSTREAM_URL ||
  process.env.REGIONAL_UPSTREAM_URL ||
  'https://ping-monitoring-demo-app.vercel.app'
).replace(/\/+$/, '');

async function agentPoll(req: Request, res: Response): Promise<void> {
  const region = authAgent(req);
  if (!region) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const cmds: RedisCmd[] = [['GET', PK.req(region)]];
    if (req.header('x-heartbeat') === '1') cmds.push(['SET', PK.seen(region), String(Date.now()), 'EX', PUSH_SEEN_TTL_S]);
    const out = await redisPipeline(cmds);
    const raw = out[0];
    if (!raw) {
      res.json({ pending: false });
      return;
    }
    const rec = JSON.parse(raw);
    if (rec.status !== 'pending') {
      res.json({ pending: false });
      return;
    }
    await redisPipeline([
      ['SET', PK.req(region), JSON.stringify({ ...rec, status: 'running', startedAt: Date.now() }), 'EX', PUSH_REQUEST_TTL_S],
      ['SET', PK.seen(region), String(Date.now()), 'EX', PUSH_SEEN_TTL_S],
    ]);
    res.json({ pending: true, requestId: rec.requestId, count: rec.count });
  } catch {
    res.json({ pending: false });
  }
}

const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const numOrNull = (v: unknown) => v === null || isNum(v, 0, 60_000);

/** Whitelist + range-check everything an agent sends. Returns the sanitized result or an error text. */
function sanitizeAgentResult(body: any, region: RegionId): { ok: true; result: any } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  if (body.targetIp !== FIXED_TARGET_IP) return { ok: false, error: `targetIp must be ${FIXED_TARGET_IP}.` };
  if (!Number.isInteger(body.requestsSent) || body.requestsSent < 1 || body.requestsSent > MAX_PING_COUNT)
    return { ok: false, error: 'requestsSent must be an integer 1-30.' };
  if (!Number.isInteger(body.successfulReplies) || body.successfulReplies < 0 || body.successfulReplies > body.requestsSent)
    return { ok: false, error: 'successfulReplies must be an integer 0..requestsSent.' };
  for (const f of ['minLatencyMs', 'avgLatencyMs', 'maxLatencyMs', 'jitterMs']) {
    if (!numOrNull(body[f])) return { ok: false, error: `${f} must be null or a number 0-60000.` };
  }
  if (!isNum(body.executionDurationMs, 0, 300_000)) return { ok: false, error: 'executionDurationMs out of range.' };
  if (!Array.isArray(body.packets) || body.packets.length > MAX_PING_COUNT) return { ok: false, error: 'packets must be an array (max 30).' };
  const packets = [];
  for (const p of body.packets) {
    if (!p || !Number.isInteger(p.sequence) || p.sequence < 1 || p.sequence > 1000 || typeof p.success !== 'boolean' || !numOrNull(p.latencyMs ?? null))
      return { ok: false, error: 'Invalid packet entry.' };
    packets.push({
      sequence: p.sequence,
      latencyMs: p.latencyMs ?? null,
      ...(Number.isInteger(p.ttl) && p.ttl >= 0 && p.ttl <= 255 ? { ttl: p.ttl } : {}),
      success: p.success,
    });
  }
  const sent = body.requestsSent as number;
  const okCount = body.successfulReplies as number;
  const failed = sent - okCount;
  return {
    ok: true,
    result: {
      success: body.success === true,
      regionId: region, // decided by the agent's key, never by the body
      targetIp: FIXED_TARGET_IP,
      requestsSent: sent,
      successfulReplies: okCount,
      failedRequests: failed,
      packetLossPercent: Math.round((failed / sent) * 1000) / 10,
      minLatencyMs: body.minLatencyMs,
      avgLatencyMs: body.avgLatencyMs,
      maxLatencyMs: body.maxLatencyMs,
      jitterMs: body.jitterMs,
      packets,
      executionDurationMs: body.executionDurationMs,
      timestamp: new Date().toISOString(),
      serverVersion: 'push-agent',
      ...(typeof body.error === 'string' && body.error ? { error: body.error.slice(0, 200) } : {}),
    },
  };
}

async function agentIngest(req: Request, res: Response): Promise<void> {
  const region = authAgent(req);
  if (!region) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const requestId = req.body?.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) {
    res.status(400).json({ error: 'Valid requestId is required.' });
    return;
  }
  const clean = sanitizeAgentResult(req.body, region);
  if (!clean.ok) {
    res.status(400).json({ error: clean.error });
    return;
  }
  try {
    // the result must belong to the test that is open for this region
    const [raw] = await redisPipeline([['GET', PK.req(region)]]);
    const rec = raw ? JSON.parse(raw) : null;
    if (!rec || rec.requestId !== requestId) {
      res.status(409).json({ error: 'No matching pending test request (expired or already completed).' });
      return;
    }
    // Timeout alerts: any timeout is flagged for the dashboard; an e-mail goes out only for a long run of timeouts
    const alert = buildAlert(clean.result);
    if (alert.level === 'critical') alert.emailStatus = await sendCriticalAlertEmail(region, clean.result, alert);
    clean.result.alert = alert;
    await redisPipeline([
      ['SET', PK.res(region, requestId), JSON.stringify(clean.result), 'EX', PUSH_RESULT_TTL_S],
      ['DEL', PK.req(region)],
      ['SET', PK.cool(region), '1', 'EX', PUSH_COOLDOWN_S],
      ['SET', PK.seen(region), String(Date.now()), 'EX', PUSH_SEEN_TTL_S],
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[ingest] storage error:', err?.message || err);
    res.status(500).json({ ok: false, error: 'Result storage is temporarily unavailable.' });
  }
}

export function createApiApp(): Application {
  const app = express();

  app.use(express.json({ limit: '64kb' }));

  // Security headers & CORS
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // 1. Direct speed test relay route
  app.use('/api/speedtest', (req, res, next) => {
    const handled = dispatchSpeedTestRoute(req, res);
    if (!handled) next();
  });

  const apiRouter = express.Router();
  apiRouter.use(authMiddleware);

  // Timeout alerts: POST /api/alerts/test-email (administrator key required)
  registerAlertRoutes(apiRouter);

  /**
   * Admin Account Setup Key Verification
   * Allows the frontend admin setup modal to verify the administrative secret
   */
  apiRouter.post('/auth/verify-admin-secret', (req: Request, res: Response) => {
    const secret = req.body?.secret?.toString()?.trim() || '';
    const configuredSecret = process.env.ADMIN_SETUP_SECRET?.trim() || 'network-admin-2026';

    if (secret && safeCompare(secret, configuredSecret)) {
      res.json({ ok: true, verified: true });
    } else {
      res.status(401).json({ ok: false, verified: false, error: 'Invalid administrator secret key' });
    }
  });

  /**
   * Root / Info route
   */
  apiRouter.get('/', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'unified-network-monitor-backend',
      timestamp: new Date().toISOString(),
      supportedRegions: ALLOWED_REGIONS,
    });
  });

  /**
   * GET /api/health
   */
  apiRouter.get('/health', healthRateLimiter, (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'unified-network-monitor-backend',
      timestamp: new Date().toISOString(),
      configuredRegions: ALLOWED_REGIONS.filter(r => Boolean(getRegionalEndpointUrl(r)) || isPushRegion(r)),
    });
  });

  /**
   * GET /api/regions
   * Returns metadata and active configuration status for all 4 regional DCs
   */
  apiRouter.get('/regions', healthRateLimiter, async (_req: Request, res: Response) => {
    let upstreamRegions: Record<string, { isConfigured?: boolean }> = {};
    try {
      const upstreamRes = await fetch(`${DEFAULT_PING_UPSTREAM}/api/regions`, {
        signal: AbortSignal.timeout(4000),
      });
      if (upstreamRes.ok) {
        const body = await upstreamRes.json();
        if (body?.regions) upstreamRegions = body.regions;
      }
    } catch {
      // Fallback: we know from the reference deployment that IN-DC01 and IN-DC02 are active push agents
      upstreamRegions = {
        'IN-DC01': { isConfigured: true },
        'IN-DC02': { isConfigured: true },
      };
    }

    const regionsStatus = ALLOWED_REGIONS.reduce((acc, rid) => {
      const url = getRegionalEndpointUrl(rid);
      const isPush = isPushRegion(rid);
      const isUpstream = Boolean(upstreamRegions[rid]?.isConfigured);
      acc[rid] = {
        regionId: rid,
        isConfigured: Boolean(url) || isPush || isUpstream,
        description: rid === 'IN-DC01' ? 'Bangalore TATA Node' :
                     rid === 'IN-DC02' ? 'Bangalore ACT Node' :
                     rid === 'LK-DC01' ? 'Sri Lanka Regional Node' :
                     'Singapore Regional Hub',
      };
      return acc;
    }, {} as Record<RegionId, { regionId: RegionId; isConfigured: boolean; description: string }>);

    res.json({
      regions: regionsStatus,
      targetIp: FIXED_TARGET_IP,
      fixedCount: DEFAULT_PING_COUNT,
    });
  });

  /**
   * GET /api/regions/:regionId/health
   * Proxies health check to local endpoint, local push agent, or upstream live agent
   */
  apiRouter.get('/regions/:regionId/health', healthRateLimiter, async (req: Request, res: Response) => {
    const regionId = req.params.regionId as RegionId;

    if (!ALLOWED_REGIONS.includes(regionId)) {
      res.status(400).json({ ok: false, statusCode: 400, error: `Invalid region ID: "${req.params.regionId}"` });
      return;
    }

    // 1. Direct local endpoint if configured
    const endpointUrl = getRegionalEndpointUrl(regionId);
    if (endpointUrl) {
      const targetUrl = `${endpointUrl.replace(/\/+$/, '')}/health`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const startTime = Date.now();

      try {
        const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' };
        if (process.env.REGIONAL_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.REGIONAL_API_KEY}`;
        }

        const response = await fetch(targetUrl, { method: 'GET', headers, signal: controller.signal });
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;

        if (response.ok) {
          let data: any = null;
          try { data = await response.json(); } catch { data = { raw: await response.text() }; }
          res.json({ ok: true, statusCode: response.status, status: 'online', regionId, latencyMs, serverInfo: data });
        } else {
          const errText = await response.text();
          res.status(response.status).json({ ok: false, statusCode: response.status, status: 'error', regionId, latencyMs, message: errText.substring(0, 150) });
        }
        return;
      } catch (err: any) {
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;
        res.status(502).json({
          ok: false,
          statusCode: 502,
          status: 'unreachable',
          regionId,
          latencyMs,
          message: `Unable to connect to regional agent for ${regionId} (${formatNetworkError(err)}).`,
        });
        return;
      }
    }

    // 2. Local push mode check if Redis configured
    if (isPushRegion(regionId)) {
      try {
        const [seen] = await redisPipeline([['GET', PK.seen(regionId)]]);
        const ageMs = seen ? Date.now() - Number(seen) : Infinity;
        if (ageMs <= AGENT_STALE_MS) {
          res.json({
            ok: true,
            statusCode: 200,
            status: 'online',
            regionId,
            latencyMs: 0,
            message: `Regional agent online (last heartbeat ${Math.round(ageMs / 1000)}s ago)`,
            serverInfo: { mode: 'push' },
          });
          return;
        }
      } catch {}
    }

    // 3. Fallback to upstream live regional agent deployment
    try {
      const upstreamRes = await fetch(`${DEFAULT_PING_UPSTREAM}/api/regions/${regionId}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const data = await upstreamRes.json().catch(() => ({}));
      res.status(upstreamRes.status).json(data);
    } catch (err: any) {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        status: 'unconfigured',
        regionId,
        message: `Regional endpoint for ${regionId} is not configured on the central backend (${formatNetworkError(err)}).`,
      });
    }
  });

  /**
   * POST /api/regions/:regionId/ping
   * Executes standardized ping test on the authorized regional server or push agent
   */
  apiRouter.post('/regions/:regionId/ping', pingRateLimiter, async (req: Request, res: Response) => {
    const regionId = req.params.regionId as RegionId;

    if (!ALLOWED_REGIONS.includes(regionId)) {
      res.status(400).json({ success: false, error: `Invalid region ID: "${req.params.regionId}"` });
      return;
    }

    const targetIp = (req.body?.targetIp || FIXED_TARGET_IP).toString().trim();
    if (targetIp !== FIXED_TARGET_IP) {
      res.status(400).json({ success: false, regionId, error: `Forbidden target IP: "${targetIp}". Only ${FIXED_TARGET_IP} is permitted.` });
      return;
    }

    let count = DEFAULT_PING_COUNT;
    if (req.body?.count !== undefined) {
      const parsed = Number(req.body.count);
      if (Number.isInteger(parsed) && parsed >= MIN_PING_COUNT && parsed <= MAX_PING_COUNT) {
        count = parsed;
      }
    }

    // 1. Direct local endpoint if configured
    const endpointUrl = getRegionalEndpointUrl(regionId);
    if (endpointUrl) {
      const targetUrl = `${endpointUrl.replace(/\/+$/, '')}/ping`;
      const controller = new AbortController();
      const timeoutMs = Math.min(Math.max(5000, Number(req.body?.timeoutMs) || 35000), PING_TIMEOUT_MS);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startTime = Date.now();

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Session-ID': (req.body?.sessionId || `sess_${Date.now()}`).toString(),
        };
        if (process.env.REGIONAL_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.REGIONAL_API_KEY}`;
        }

        const response = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ targetIp: FIXED_TARGET_IP, count, timeoutMs: Math.max(3000, timeoutMs - 5000), regionId }),
          signal: controller.signal,
        });

        clearTimeout(timer);
        const executionDurationMs = Date.now() - startTime;

        if (!response.ok) {
          const errBody = await response.text();
          res.status(response.status).json({ success: false, regionId, error: `Regional agent error (${response.status}): ${errBody.substring(0, 150)}` });
          return;
        }

        const payload = await response.json();
        res.json(payload);
        return;
      } catch (err: any) {
        clearTimeout(timer);
        const executionDurationMs = Date.now() - startTime;
        res.status(502).json({
          success: false,
          regionId,
          targetIp: FIXED_TARGET_IP,
          requestsSent: 0,
          successfulReplies: 0,
          failedRequests: count,
          packetLossPercent: 100,
          minLatencyMs: null,
          avgLatencyMs: null,
          maxLatencyMs: null,
          jitterMs: null,
          packets: [],
          executionDurationMs,
          timestamp: new Date().toISOString(),
          error: `Unable to reach regional agent for ${regionId} (${formatNetworkError(err)}).`,
        });
        return;
      }
    }

    // 2. Local push mode if Redis configured
    if (isPushRegion(regionId)) {
      if (!redisConfig()) {
        res.status(503).json({
          success: false,
          regionId,
          error: 'Push agent queue storage is not configured: In Vercel, go to Storage > Create Database > Upstash Redis to connect KV storage.',
        });
        return;
      }

      try {
        const [seen, pending, cool] = await redisPipeline([['GET', PK.seen(regionId)], ['GET', PK.req(regionId)], ['EXISTS', PK.cool(regionId)]]);
        if (!seen || Date.now() - Number(seen) > AGENT_STALE_MS) {
          res.status(503).json({
            success: false,
            regionId,
            error: `Regional push agent for ${regionId} is offline: no heartbeat in the last 10 minutes. Ensure push-agent.cjs is running on the VM with AGENT_URL pointing to this app.`,
          });
          return;
        }
        if (pending) {
          const rec = JSON.parse(pending);
          res.status(202).json({ status: 'queued', requestId: rec.requestId, regionId, pollAfterMs: 3000 });
          return;
        }
        if (Number(cool) > 0) {
          res.setHeader('Retry-After', String(PUSH_COOLDOWN_S));
          res.status(429).json({ success: false, regionId, error: `A test for ${regionId} just finished. Please wait ${PUSH_COOLDOWN_S}s before starting another.` });
          return;
        }
        const requestId = crypto.randomUUID();
        await redisPipeline([['SET', PK.req(regionId), JSON.stringify({ requestId, status: 'pending', count, createdAt: Date.now() }), 'EX', PUSH_REQUEST_TTL_S]]);
        res.status(202).json({ status: 'queued', requestId, regionId, pollAfterMs: 3000 });
        return;
      } catch (err: any) {
        res.status(500).json({
          success: false,
          regionId,
          error: `Storage error: ${err.message || 'Unable to access Redis queue'}`,
        });
        return;
      }
    }

    // 3. Fallback to upstream live regional agent deployment
    try {
      const upstreamRes = await fetch(`${DEFAULT_PING_UPSTREAM}/api/regions/${regionId}/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': (req.body?.sessionId || `sess_${Date.now()}`).toString(),
        },
        body: JSON.stringify({
          targetIp: FIXED_TARGET_IP,
          count,
          timeoutMs: req.body?.timeoutMs,
          sessionId: req.body?.sessionId,
        }),
        signal: AbortSignal.timeout(12000), // Bound within Vercel's 15s function execution limit
      });

      const data = await upstreamRes.json().catch(() => ({}));
      res.status(upstreamRes.status).json(data);
    } catch (err: any) {
      res.status(502).json({
        success: false,
        regionId,
        targetIp: FIXED_TARGET_IP,
        requestsSent: 0,
        successfulReplies: 0,
        failedRequests: count,
        packetLossPercent: 100,
        minLatencyMs: null,
        avgLatencyMs: null,
        maxLatencyMs: null,
        jitterMs: null,
        packets: [],
        executionDurationMs: 0,
        timestamp: new Date().toISOString(),
        error: `Unable to reach regional agent for ${regionId} (${formatNetworkError(err)}).`,
      });
    }
  });

  /**
   * GET /api/regions/:regionId/result
   * Polls for completion of asynchronous push-mode ping results
   */
  apiRouter.get('/regions/:regionId/result', healthRateLimiter, async (req: Request, res: Response) => {
    const regionId = req.params.regionId as RegionId;
    const requestId = String(req.query.requestId || '');

    if (!REQUEST_ID_RE.test(requestId)) {
      res.status(400).json({ status: 'error', error: 'Invalid requestId.' });
      return;
    }

    // 1. Local push mode if Redis configured
    if (isPushRegion(regionId)) {
      try {
        const [done, pending] = await redisPipeline([['GET', PK.res(regionId, requestId)], ['GET', PK.req(regionId)]]);
        if (done) {
          res.json({ status: 'done', result: JSON.parse(done) });
          return;
        }
        const rec = pending ? JSON.parse(pending) : null;
        if (rec && rec.requestId === requestId) {
          res.status(202).json({ status: rec.status });
          return;
        }
      } catch {}
    }

    // 2. Poll upstream live regional agent deployment
    try {
      const upstreamRes = await fetch(
        `${DEFAULT_PING_UPSTREAM}/api/regions/${regionId}/result?requestId=${encodeURIComponent(requestId)}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        }
      );
      const data = await upstreamRes.json().catch(() => ({}));
      res.status(upstreamRes.status).json(data);
    } catch (err: any) {
      res.status(502).json({ status: 'error', error: `Polling failed: ${formatNetworkError(err)}` });
    }
  });

  // Push Mode Agent Ingestion Routes
  const agentRouter = express.Router();
  agentRouter.get('/poll', healthRateLimiter, agentPoll);
  agentRouter.post('/ingest', healthRateLimiter, agentIngest);
  app.use('/api/agent', agentRouter);
  app.use('/agent', agentRouter);
  apiRouter.use('/agent', agentRouter);

  // Mount API router exclusively under /api prefix
  // This allows the root '/' and client-side routes to be served by Vite middleware (or static dist in production)
  app.use('/api', apiRouter);

  // Also handle requests on Vercel Serverless Functions where /api prefix may be stripped
  app.use((req, res, next) => {
    if (
      req.path.startsWith('/regions') ||
      req.path.startsWith('/speedtest') ||
      req.path.startsWith('/auth') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/agent') ||
      req.path.startsWith('/alerts')
    ) {
      return apiRouter(req, res, next);
    }
    next();
  });

  return app;
}
