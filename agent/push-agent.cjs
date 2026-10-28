#!/usr/bin/env node
/**
 * Regional Ping Push Agent  (zero dependencies, Node 18+, Linux)
 *
 * Runs ON the regional VM. Makes OUTBOUND HTTPS calls only; listens on no port.
 *  - polls the central app every POLL_INTERVAL_SEC for a "test requested" flag
 *  - when asked, runs a REAL `ping -c <n> 8.8.8.8` on this VM and pushes the result
 *  - sends a heartbeat about every 5 minutes so the dashboard can show "online/offline"
 *
 * Env:
 *   AGENT_URL   e.g. https://ping-monitoring-demo-app.vercel.app   (required)
 *   AGENT_KEY   this region's secret key (AGENT_KEY_IN_DC02 value in Vercel) (required)
 *   POLL_INTERVAL_SEC  default 30 (min 2)
 */
'use strict';
const { execFile } = require('node:child_process');

const TARGET = '8.8.8.8'; // fixed on purpose; never taken from the server
const MAX_COUNT = 30;
const HEARTBEAT_EVERY_MS = 300_000; // 5 minutes (keeps Upstash usage inside the free plan)

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Parse Linux iputils `ping` output into the result shape the backend expects. */
function parsePingOutput(stdout, count) {
  const replies = new Map();
  for (const line of stdout.split('\n')) {
    const m = line.match(/icmp_seq=(\d+)\s+ttl=(\d+)\s+time=([\d.]+)\s*ms/i);
    if (m) replies.set(parseInt(m[1], 10), { ttl: parseInt(m[2], 10), latencyMs: parseFloat(m[3]) });
  }
  const sum = stdout.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets )?received/);
  const sent = sum ? Math.min(parseInt(sum[1], 10), MAX_COUNT) : count;

  const packets = [];
  const lat = [];
  for (let seq = 1; seq <= sent; seq++) {
    const r = replies.get(seq);
    if (r) {
      packets.push({ sequence: seq, ttl: r.ttl, latencyMs: r.latencyMs, success: true });
      lat.push(r.latencyMs);
    } else {
      packets.push({ sequence: seq, latencyMs: null, success: false });
    }
  }
  let jitter = null;
  if (lat.length > 1) {
    let s = 0;
    for (let i = 1; i < lat.length; i++) s += Math.abs(lat[i] - lat[i - 1]);
    jitter = round3(s / (lat.length - 1));
  }
  return {
    parsedSummary: Boolean(sum),
    requestsSent: sent,
    successfulReplies: lat.length,
    minLatencyMs: lat.length ? round3(Math.min(...lat)) : null,
    avgLatencyMs: lat.length ? round3(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    maxLatencyMs: lat.length ? round3(Math.max(...lat)) : null,
    jitterMs: jitter,
    packets,
  };
}

/** Run the real ping on this machine. execFile with an argument array: no shell involved. */
function runPing(count) {
  const n = Math.min(Math.max(1, Math.trunc(count) || MAX_COUNT), MAX_COUNT);
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      'ping',
      ['-n', '-c', String(n), '-i', '1', '-W', '2', TARGET],
      { timeout: (n + 15) * 1000, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        const executionDurationMs = Date.now() - started;
        const parsed = parsePingOutput(String(stdout || ''), n);
        // exit code 1 just means "some packets lost": stdout is still valid.
        if (!parsed.parsedSummary) {
          const why = String(stderr || (err && err.message) || 'ping produced no summary').trim().slice(0, 150);
          return resolve({
            success: false,
            error: `Ping failed on agent: ${why}`,
            targetIp: TARGET,
            requestsSent: n,
            successfulReplies: 0,
            minLatencyMs: null, avgLatencyMs: null, maxLatencyMs: null, jitterMs: null,
            packets: Array.from({ length: n }, (_, i) => ({ sequence: i + 1, latencyMs: null, success: false })),
            executionDurationMs,
          });
        }
        const { parsedSummary, ...rest } = parsed;
        resolve({ success: true, targetIp: TARGET, ...rest, executionDurationMs });
      }
    );
  });
}

async function api(base, key, path, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${base}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function pushResult(base, key, requestId, result) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await api(base, key, '/api/agent/ingest', { method: 'POST', body: JSON.stringify({ requestId, ...result }) });
      if (r.ok) return log(`result pushed (request ${requestId})`);
      const txt = (await r.text()).slice(0, 200);
      log(`ingest rejected HTTP ${r.status}: ${txt}`);
      if (r.status >= 400 && r.status < 500) return; // retrying will not help
    } catch (e) {
      log(`ingest attempt ${attempt} failed: ${e.message}`);
    }
    await sleep(2000 * attempt);
  }
}

async function main() {
  const base = (process.env.AGENT_URL || '').replace(/\/+$/, '');
  const key = (process.env.AGENT_KEY || '').trim();
  const pollMs = Math.max(2, Number(process.env.POLL_INTERVAL_SEC) || 30) * 1000;
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) {
    console.error('AGENT_URL must be an https:// URL (e.g. https://ping-monitoring-demo-app.vercel.app)');
    process.exit(1);
  }
  if (key.length < 24) {
    console.error('AGENT_KEY is missing or too short.');
    process.exit(1);
  }
  log(`agent started: polling ${base} every ${pollMs / 1000}s (target ${TARGET})`);

  let lastHeartbeat = 0;
  let lastError = '';
  for (;;) {
    try {
      const beat = Date.now() - lastHeartbeat >= HEARTBEAT_EVERY_MS;
      const r = await api(base, key, '/api/agent/poll', { method: 'GET', headers: beat ? { 'X-Heartbeat': '1' } : {} });
      if (r.status === 401) {
        if (lastError !== '401') log('server rejected the agent key (HTTP 401). Check AGENT_KEY matches Vercel.');
        lastError = '401';
      } else if (!r.ok) {
        const m = `poll HTTP ${r.status}`;
        if (lastError !== m) log(m);
        lastError = m;
      } else {
        if (lastError) log('connection to server OK');
        lastError = '';
        if (beat) lastHeartbeat = Date.now();
        const job = await r.json();
        if (job.pending && typeof job.requestId === 'string') {
          log(`test requested (${job.requestId}); running ping -c ${job.count || MAX_COUNT} ${TARGET}`);
          const result = await runPing(job.count);
          log(`ping finished: ${result.successfulReplies}/${result.requestsSent} replies`);
          await pushResult(base, key, job.requestId, result);
          continue; // check immediately for another request
        }
      }
    } catch (e) {
      const m = `poll failed: ${e.message}`;
      if (lastError !== m) log(m);
      lastError = m;
    }
    await sleep(pollMs);
  }
}

module.exports = { parsePingOutput, runPing };
if (require.main === module) main();
