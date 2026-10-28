/**
 * Authorized Regional Ping Daemon Service
 * 
 * Standalone, zero-dependency Node.js HTTP service designed to be deployed on
 * authorized regional servers (IN-DC01, IN-DC02, LK-DC01, SG-DC01).
 * 
 * Security Directives:
 * 1. Fixed ICMP ping execution: Invokes `execFile('ping', args)` directly (NEVER raw shell strings).
 * 2. Strict IPv4 format validation: Default fixed target 8.8.8.8.
 * 3. Bounded count: Maximum 30 packets per execution.
 * 4. Full CORS support for cross-origin dashboard requests.
 * 5. Structured ICMP response parsing (Linux & Windows).
 */

const http = require('node:http');
const { execFile } = require('node:child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const REGION_ID = process.env.REGION_ID || 'IN-DC01';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-ID');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Parses Linux ping stdout
 */
function parseLinuxPingOutput(stdout, count, durationMs) {
  const lines = stdout.split('\n');
  const packets = [];
  let seq = 1;

  for (const line of lines) {
    // Example: 64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=14.2 ms
    const packetMatch = line.match(/icmp_seq=(\d+)\s+ttl=(\d+)\s+time=([\d.]+)\s*ms/i);
    if (packetMatch) {
      packets.push({
        sequence: parseInt(packetMatch[1], 10),
        ttl: parseInt(packetMatch[2], 10),
        latencyMs: parseFloat(packetMatch[3]),
        success: true,
      });
      continue;
    }
    // Example: Request timeout or destination unreachable
    if (line.includes('Destination Host Unreachable') || line.includes('Time to live exceeded')) {
      packets.push({
        sequence: seq++,
        latencyMs: null,
        success: false,
      });
    }
  }

  // Statistics line: 30 packets transmitted, 30 received, 0% packet loss, time 29038ms
  const statsMatch = stdout.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets\s+)?received(?:,\s+\+(\d+)\s+errors)?,\s+([\d.]+)%\s+packet loss/i);
  const requestsSent = statsMatch ? parseInt(statsMatch[1], 10) : count;
  const successfulReplies = statsMatch ? parseInt(statsMatch[2], 10) : packets.filter(p => p.success).length;
  const packetLossPercent = statsMatch ? parseFloat(statsMatch[4]) : Math.round(((requestsSent - successfulReplies) / requestsSent) * 100);
  const failedRequests = Math.max(0, requestsSent - successfulReplies);

  // RTT line: rtt min/avg/max/mdev = 12.345/14.567/18.901/1.234 ms
  const rttMatch = stdout.match(/(?:rtt|round-trip)\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/i);
  let minLatencyMs = rttMatch ? parseFloat(rttMatch[1]) : null;
  let avgLatencyMs = rttMatch ? parseFloat(rttMatch[2]) : null;
  let maxLatencyMs = rttMatch ? parseFloat(rttMatch[3]) : null;
  let jitterMs = rttMatch ? parseFloat(rttMatch[4]) : null;

  // Fallback calculation from individual packets if RTT line was not matched
  if (avgLatencyMs === null && packets.length > 0) {
    const valid = packets.filter(p => p.success && p.latencyMs !== null).map(p => p.latencyMs);
    if (valid.length > 0) {
      minLatencyMs = Math.min(...valid);
      maxLatencyMs = Math.max(...valid);
      avgLatencyMs = parseFloat((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1));
    }
  }

  return {
    requestsSent,
    successfulReplies,
    failedRequests,
    packetLossPercent,
    minLatencyMs,
    avgLatencyMs,
    maxLatencyMs,
    jitterMs,
    packets,
  };
}

/**
 * Parses Windows ping stdout
 */
function parseWindowsPingOutput(stdout, count, durationMs) {
  const lines = stdout.split('\n');
  const packets = [];
  let seq = 1;

  for (const line of lines) {
    // Example: Reply from 8.8.8.8: bytes=32 time=14ms TTL=118
    // or time<1ms
    const replyMatch = line.match(/Reply from [^:]+:\s+bytes=\d+\s+time(?:=|<)([\d.]+)ms\s+TTL=(\d+)/i);
    if (replyMatch) {
      packets.push({
        sequence: seq++,
        latencyMs: Math.max(1, parseFloat(replyMatch[1])),
        ttl: parseInt(replyMatch[2], 10),
        success: true,
      });
      continue;
    }
    if (line.includes('Request timed out') || line.includes('Destination host unreachable')) {
      packets.push({
        sequence: seq++,
        latencyMs: null,
        success: false,
      });
    }
  }

  // Packets: Sent = 30, Received = 30, Lost = 0 (0% loss)
  const statsMatch = stdout.match(/Packets:\s+Sent\s*=\s*(\d+),\s*Received\s*=\s*(\d+),\s*Lost\s*=\s*(\d+)\s*\(([\d.]+)%\s*loss\)/i);
  const requestsSent = statsMatch ? parseInt(statsMatch[1], 10) : count;
  const successfulReplies = statsMatch ? parseInt(statsMatch[2], 10) : packets.filter(p => p.success).length;
  const failedRequests = statsMatch ? parseInt(statsMatch[3], 10) : Math.max(0, requestsSent - successfulReplies);
  const packetLossPercent = statsMatch ? parseFloat(statsMatch[4]) : Math.round(((requestsSent - successfulReplies) / requestsSent) * 100);

  // Minimum = 12ms, Maximum = 18ms, Average = 14ms
  const rttMatch = stdout.match(/Minimum\s*=\s*(\d+)ms,\s*Maximum\s*=\s*(\d+)ms,\s*Average\s*=\s*(\d+)ms/i);
  let minLatencyMs = rttMatch ? parseInt(rttMatch[1], 10) : null;
  let maxLatencyMs = rttMatch ? parseInt(rttMatch[2], 10) : null;
  let avgLatencyMs = rttMatch ? parseInt(rttMatch[3], 10) : null;

  if (avgLatencyMs === null && packets.length > 0) {
    const valid = packets.filter(p => p.success && p.latencyMs !== null).map(p => p.latencyMs);
    if (valid.length > 0) {
      minLatencyMs = Math.min(...valid);
      maxLatencyMs = Math.max(...valid);
      avgLatencyMs = parseFloat((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1));
    }
  }

  return {
    requestsSent,
    successfulReplies,
    failedRequests,
    packetLossPercent,
    minLatencyMs,
    avgLatencyMs,
    maxLatencyMs,
    jitterMs: null,
    packets,
  };
}

/**
 * Safely executes native OS ping without shell invocation
 */
function executeNativePing(targetIp, count) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    // Linux/macOS uses -c, Windows uses -n
    const args = isWindows
      ? ['-n', String(count), '-w', '2000', targetIp]
      : ['-c', String(count), '-W', '2', targetIp];

    const startTime = Date.now();

    execFile('ping', args, { timeout: 45000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const combinedOutput = (stdout || '') + (stderr || '');

      // Ping can exit with non-zero if there was partial or total packet loss, but stdout still contains the stats!
      if (!combinedOutput && error) {
        return reject(new Error(`Failed to execute ping process: ${error.message}`));
      }

      try {
        const parsed = isWindows
          ? parseWindowsPingOutput(combinedOutput, count, durationMs)
          : parseLinuxPingOutput(combinedOutput, count, durationMs);

        resolve({
          ...parsed,
          executionDurationMs: durationMs,
          rawOutputSnippet: combinedOutput.slice(-500),
        });
      } catch (parseErr) {
        reject(new Error(`Failed to parse ping stdout: ${parseErr.message}`));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health check endpoint
  if ((url.pathname === '/health' || url.pathname === '/status') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      regionId: REGION_ID,
      platform: process.platform,
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      daemonVersion: '1.2.0',
      fixedTarget: '8.8.8.8',
      fixedCount: 30,
    }));
    return;
  }

  // Ping execution endpoint
  if (url.pathname === '/ping' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        let payload = {};
        if (body.trim()) {
          try {
            payload = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON request payload' }));
            return;
          }
        }

        // Target IP: strictly validated, defaults to 8.8.8.8
        let targetIp = (payload.targetIp || '8.8.8.8').trim();
        if (!IPV4_REGEX.test(targetIp)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Invalid target IPv4 address: ${targetIp}` }));
          return;
        }

        // Ping count: fixed 30, maximum 30
        let count = 30;
        if (payload.count && Number.isInteger(payload.count)) {
          count = Math.min(Math.max(1, payload.count), 30);
        }

        console.log(`[${new Date().toISOString()}] Executing regional ping: target=${targetIp}, count=${count}, region=${REGION_ID}`);

        const result = await executeNativePing(targetIp, count);

        const responsePayload = {
          success: result.packetLossPercent < 100,
          regionId: REGION_ID,
          targetIp,
          requestsSent: result.requestsSent,
          successfulReplies: result.successfulReplies,
          failedRequests: result.failedRequests,
          packetLossPercent: result.packetLossPercent,
          minLatencyMs: result.minLatencyMs,
          avgLatencyMs: result.avgLatencyMs,
          maxLatencyMs: result.maxLatencyMs,
          jitterMs: result.jitterMs,
          packets: result.packets,
          executionDurationMs: result.executionDurationMs,
          timestamp: new Date().toISOString(),
          serverVersion: '1.2.0',
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responsePayload));
      } catch (err) {
        console.error('Ping execution failure:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          regionId: REGION_ID,
          error: err.message || 'Regional ping daemon error',
          timestamp: new Date().toISOString(),
        }));
      }
    });
    return;
  }

  // Not Found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found. Supported routes: GET /health, POST /ping' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`Regional Ping Daemon listening on 0.0.0.0:${PORT}`);
  console.log(`Assigned Region: ${REGION_ID}`);
  console.log(`Endpoints:`);
  console.log(`  - GET  /health`);
  console.log(`  - POST /ping`);
  console.log(`Security: execFile direct process execution (no shell)`);
  console.log(`Target: 8.8.8.8 | Count: 30 packets`);
  console.log(`=======================================================`);
});
