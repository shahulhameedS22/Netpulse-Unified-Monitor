// src/server/app.ts
import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";

// src/server/speedTestApi.ts
import https from "https";
import { URL as URL2 } from "url";
var ALLOWED_TARGET_HOSTS = /* @__PURE__ */ new Set([
  "lk-dc01.trainocate.com:8443",
  "sg-dc01.trainocate.com:8443",
  "in-dc01.trainocate.com:8443",
  "in-dc02.trainocate.com:8443"
]);
function getQueryParams(req) {
  const fullUrl = new URL2(req.url || "/", "http://127.0.0.1");
  return fullUrl.searchParams;
}
function handleRelay(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  const query = getQueryParams(req);
  const targetStr = query.get("target");
  if (!targetStr) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Missing target URL" }));
    return;
  }
  let targetUrl;
  try {
    targetUrl = new URL2(targetStr);
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid target URL format" }));
    return;
  }
  if (!ALLOWED_TARGET_HOSTS.has(targetUrl.host)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: "Host not permitted in relay" }));
    return;
  }
  const headers = {
    "User-Agent": "Unified-Network-Monitor/1.0",
    "Cache-Control": "no-store, no-cache",
    "Pragma": "no-cache"
  };
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 8443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method || "GET",
    headers,
    rejectUnauthorized: true
  };
  if (req.method === "GET" || req.method === "HEAD") {
    const proxyReq = https.request(options, (proxyRes) => {
      res.statusCode = proxyRes.statusCode || 200;
      if (proxyRes.headers["content-type"]) {
        res.setHeader("Content-Type", proxyRes.headers["content-type"]);
      }
      if (proxyRes.headers["content-length"]) {
        res.setHeader("Content-Length", proxyRes.headers["content-length"]);
      }
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: `Relay failed: ${err.message}` }));
      }
    });
    proxyReq.end();
    req.on("close", () => {
      proxyReq.destroy();
    });
  } else {
    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(bodyChunks);
      headers["content-length"] = body.length;
      if (req.headers["content-type"]) {
        headers["content-type"] = req.headers["content-type"];
      }
      const proxyReq = https.request(options, (proxyRes) => {
        res.statusCode = proxyRes.statusCode || 200;
        proxyRes.pipe(res);
      });
      proxyReq.on("error", (err) => {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: `Relay failed: ${err.message}` }));
        }
      });
      proxyReq.write(body);
      proxyReq.end();
    });
  }
}
function dispatchSpeedTestRoute(req, res) {
  const urlPath = (req.url || "").split("?")[0];
  if (urlPath === "/api/speedtest/relay") {
    handleRelay(req, res);
    return true;
  }
  return false;
}

// src/server/app.ts
dotenv.config();
var ALLOWED_REGIONS = ["IN-DC01", "IN-DC02", "LK-DC01", "SG-DC01"];
var FIXED_TARGET_IP = "8.8.8.8";
var DEFAULT_PING_COUNT = 30;
var MIN_PING_COUNT = 1;
var MAX_PING_COUNT = 30;
var HEALTH_TIMEOUT_MS = 6e3;
var PING_TIMEOUT_MS = 45e3;
function getRegionalEndpointUrl(regionId) {
  switch (regionId) {
    case "IN-DC01":
      return process.env.REGIONAL_IN_DC01_URL?.trim() || null;
    case "IN-DC02":
      return process.env.REGIONAL_IN_DC02_URL?.trim() || null;
    case "LK-DC01":
      return process.env.REGIONAL_LK_DC01_URL?.trim() || null;
    case "SG-DC01":
      return process.env.REGIONAL_SG_DC01_URL?.trim() || null;
    default:
      return null;
  }
}
function formatNetworkError(err) {
  if (!err) return "Network failure";
  if (err.name === "AbortError") return "Connection timed out";
  if (err.code === "ECONNREFUSED") return "Connection refused (service not listening or port blocked)";
  if (err.code === "ENETUNREACH") return "Network unreachable (no route to IP)";
  if (err.code === "EHOSTUNREACH") return "Host unreachable (target VM offline or subnet not routed)";
  if (err.code === "ETIMEDOUT") return "Network connection timed out";
  return err.message || "Unknown network error";
}
function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || "unknown-client";
}
function validatePublicRequestOrigin(req) {
  const secFetchSite = req.headers["sec-fetch-site"];
  if (typeof secFetchSite === "string" && secFetchSite === "cross-site") {
    return {
      allowed: false,
      reason: "Cross-site request rejected: Ping test execution is restricted to the Network Monitoring dashboard."
    };
  }
  const origin = req.headers["origin"];
  const host = req.headers["host"];
  if (typeof origin === "string" && host) {
    try {
      const originHost = new URL(origin).host;
      const isSameHost = originHost === host;
      const isAllowedHost = isSameHost || originHost.endsWith(".vercel.app") || originHost.endsWith(".run.app") || originHost.includes("localhost") || originHost.includes("127.0.0.1");
      if (!isAllowedHost) {
        return {
          allowed: false,
          reason: `Untrusted origin "${originHost}". Cross-origin ping execution is restricted.`
        };
      }
    } catch {
      return { allowed: false, reason: "Malformed Origin header." };
    }
  }
  return { allowed: true };
}
var pingRateLimitStore = /* @__PURE__ */ new Map();
var healthRateLimitStore = /* @__PURE__ */ new Map();
function pruneStaleRateLimits() {
  const now = Date.now();
  for (const [ip, rec] of pingRateLimitStore.entries()) {
    rec.timestamps = rec.timestamps.filter((t) => now - t < 12e4);
    if (rec.timestamps.length === 0 && rec.inFlight <= 0) {
      pingRateLimitStore.delete(ip);
    }
  }
  for (const [ip, timestamps] of healthRateLimitStore.entries()) {
    const fresh = timestamps.filter((t) => now - t < 6e4);
    if (fresh.length === 0) {
      healthRateLimitStore.delete(ip);
    } else {
      healthRateLimitStore.set(ip, fresh);
    }
  }
}
function authMiddleware(req, res, next) {
  const expectedKey = process.env.CENTRAL_API_KEY?.trim();
  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  let providedToken = null;
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    providedToken = apiKeyHeader.trim();
  } else if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    providedToken = authHeader.substring(7).trim();
  }
  if (providedToken) {
    if (!expectedKey) {
      res.status(500).json({
        ok: false,
        error: "Server configuration error: Authentication credentials provided, but CENTRAL_API_KEY is not configured.",
        code: "AUTH_CONFIG_MISSING"
      });
      return;
    }
    if (!safeCompare(providedToken, expectedKey)) {
      res.status(401).json({
        ok: false,
        error: "Unauthorized: Invalid authentication credentials.",
        code: "UNAUTHORIZED"
      });
      return;
    }
    req.isApiKeyAuthenticated = true;
    return next();
  }
  if (process.env.REQUIRE_AUTH === "true") {
    res.status(401).json({
      ok: false,
      error: "Unauthorized: Authentication is strictly required (REQUIRE_AUTH=true).",
      code: "UNAUTHORIZED"
    });
    return;
  }
  req.isApiKeyAuthenticated = false;
  next();
}
function healthRateLimiter(req, res, next) {
  if (req.isApiKeyAuthenticated) return next();
  pruneStaleRateLimits();
  const ip = getClientIp(req);
  const now = Date.now();
  let timestamps = healthRateLimitStore.get(ip) || [];
  timestamps = timestamps.filter((t) => now - t < 6e4);
  if (timestamps.length >= 60) {
    res.setHeader("Retry-After", "10");
    res.status(429).json({
      ok: false,
      error: "Too many health check requests.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: 10
    });
    return;
  }
  timestamps.push(now);
  healthRateLimitStore.set(ip, timestamps);
  next();
}
function pingRateLimiter(req, res, next) {
  if (req.isApiKeyAuthenticated) return next();
  const originCheck = validatePublicRequestOrigin(req);
  if (!originCheck.allowed) {
    res.status(403).json({
      success: false,
      error: originCheck.reason || "Forbidden: Cross-site request rejected.",
      code: "CROSS_SITE_FORBIDDEN"
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
  rec.timestamps = rec.timestamps.filter((t) => now - t < 12e4);
  if (rec.inFlight >= 4) {
    res.setHeader("Retry-After", "5");
    res.status(429).json({
      success: false,
      error: "Concurrency limit reached: 4 ping tests already in progress.",
      code: "CONCURRENCY_LIMIT_EXCEEDED",
      retryAfterSeconds: 5
    });
    return;
  }
  if (rec.timestamps.length >= 6) {
    const oldest = rec.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((12e4 - (now - oldest)) / 1e3));
    res.setHeader("Retry-After", retryAfterSeconds.toString());
    res.status(429).json({
      success: false,
      error: `Rate limit reached. Please wait ${retryAfterSeconds}s before starting new tests.`,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds
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
  res.on("finish", releaseSlot);
  res.on("close", releaseSlot);
  next();
}
var agentKeyEnvName = (r) => `AGENT_KEY_${r.replace(/-/g, "_")}`;
function isPushRegion(regionId) {
  return ALLOWED_REGIONS.includes(regionId) && Boolean(process.env[agentKeyEnvName(regionId)]?.trim());
}
function createApiApp() {
  const app2 = express();
  app2.use(express.json({ limit: "64kb" }));
  app2.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app2.use("/api/speedtest", (req, res, next) => {
    const handled = dispatchSpeedTestRoute(req, res);
    if (!handled) next();
  });
  const apiRouter = express.Router();
  apiRouter.use(authMiddleware);
  apiRouter.post("/auth/verify-admin-secret", (req, res) => {
    const secret = req.body?.secret?.toString()?.trim() || "";
    const configuredSecret = process.env.ADMIN_SETUP_SECRET?.trim() || "network-admin-2026";
    if (secret && safeCompare(secret, configuredSecret)) {
      res.json({ ok: true, verified: true });
    } else {
      res.status(401).json({ ok: false, verified: false, error: "Invalid administrator secret key" });
    }
  });
  apiRouter.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "unified-network-monitor-backend",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      supportedRegions: ALLOWED_REGIONS
    });
  });
  apiRouter.get("/health", healthRateLimiter, (_req, res) => {
    res.json({
      status: "ok",
      service: "unified-network-monitor-backend",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      configuredRegions: ALLOWED_REGIONS.filter((r) => Boolean(getRegionalEndpointUrl(r)) || isPushRegion(r))
    });
  });
  apiRouter.get("/regions", healthRateLimiter, (_req, res) => {
    const regionsStatus = ALLOWED_REGIONS.reduce((acc, rid) => {
      const url = getRegionalEndpointUrl(rid);
      acc[rid] = {
        regionId: rid,
        isConfigured: Boolean(url) || isPushRegion(rid),
        description: rid === "IN-DC01" ? "Bangalore TATA Node" : rid === "IN-DC02" ? "Bangalore ACT Node" : rid === "LK-DC01" ? "Sri Lanka Regional Node" : "Singapore Regional Hub"
      };
      return acc;
    }, {});
    res.json({
      regions: regionsStatus,
      targetIp: FIXED_TARGET_IP,
      fixedCount: DEFAULT_PING_COUNT
    });
  });
  apiRouter.get("/regions/:regionId/health", healthRateLimiter, async (req, res) => {
    const regionId = req.params.regionId;
    if (!ALLOWED_REGIONS.includes(regionId)) {
      res.status(400).json({ ok: false, statusCode: 400, error: `Invalid region ID: "${req.params.regionId}"` });
      return;
    }
    const endpointUrl = getRegionalEndpointUrl(regionId);
    if (!endpointUrl) {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        status: "unconfigured",
        regionId,
        message: `Regional endpoint for ${regionId} is not configured on the central backend.`
      });
      return;
    }
    const targetUrl = `${endpointUrl.replace(/\/+$/, "")}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const startTime = Date.now();
    try {
      const headers = { Accept: "application/json, text/plain, */*" };
      if (process.env.REGIONAL_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.REGIONAL_API_KEY}`;
      }
      const response = await fetch(targetUrl, { method: "GET", headers, signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      if (response.ok) {
        let data = null;
        try {
          data = await response.json();
        } catch {
          data = { raw: await response.text() };
        }
        res.json({ ok: true, statusCode: response.status, status: "online", regionId, latencyMs, serverInfo: data });
      } else {
        const errText = await response.text();
        res.status(response.status).json({ ok: false, statusCode: response.status, status: "error", regionId, latencyMs, message: errText.substring(0, 150) });
      }
    } catch (err) {
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      res.status(502).json({
        ok: false,
        statusCode: 502,
        status: "unreachable",
        regionId,
        latencyMs,
        message: `Unable to connect to regional agent for ${regionId} (${formatNetworkError(err)}).`
      });
    }
  });
  apiRouter.post("/regions/:regionId/ping", pingRateLimiter, async (req, res) => {
    const regionId = req.params.regionId;
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
    if (req.body?.count !== void 0) {
      const parsed = Number(req.body.count);
      if (Number.isInteger(parsed) && parsed >= MIN_PING_COUNT && parsed <= MAX_PING_COUNT) {
        count = parsed;
      }
    }
    const endpointUrl = getRegionalEndpointUrl(regionId);
    if (!endpointUrl) {
      res.status(503).json({
        success: false,
        regionId,
        error: `Regional endpoint for ${regionId} is not configured on the central backend.`
      });
      return;
    }
    const targetUrl = `${endpointUrl.replace(/\/+$/, "")}/ping`;
    const controller = new AbortController();
    const timeoutMs = Math.min(Math.max(5e3, Number(req.body?.timeoutMs) || 35e3), PING_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();
    try {
      const headers = {
        "Content-Type": "application/json",
        "X-Session-ID": (req.body?.sessionId || `sess_${Date.now()}`).toString()
      };
      if (process.env.REGIONAL_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.REGIONAL_API_KEY}`;
      }
      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ targetIp: FIXED_TARGET_IP, count, timeoutMs: Math.max(3e3, timeoutMs - 5e3), regionId }),
        signal: controller.signal
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
    } catch (err) {
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
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        error: `Unable to reach regional agent for ${regionId} (${formatNetworkError(err)}).`
      });
    }
  });
  app2.use("/api", apiRouter);
  return app2;
}

// api/index.ts
var app = createApiApp();
var index_default = app;
export {
  index_default as default
};
