/**
 * Transparent Streaming Relay for LibreSpeed External Regional Servers
 * 
 * Relays real live network data between the browser and target servers:
 * - IN-DC01 (in-dc01.trainocate.com:8443)
 * - IN-DC02 (in-dc02.trainocate.com:8443)
 * - LK-DC01 (lk-dc01.trainocate.com:8443)
 * - SG-DC01 (sg-dc01.trainocate.com:8443)
 * 
 * Ensures CORS compatibility and chunked binary streaming.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import { URL } from 'url';

const ALLOWED_TARGET_HOSTS = new Set([
  'lk-dc01.trainocate.com:8443',
  'sg-dc01.trainocate.com:8443',
  'in-dc01.trainocate.com:8443',
  'in-dc02.trainocate.com:8443',
]);

function getQueryParams(req: IncomingMessage): URLSearchParams {
  const fullUrl = new URL(req.url || '/', 'http://127.0.0.1');
  return fullUrl.searchParams;
}

export function handleRelay(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Pragma');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const query = getQueryParams(req);
  const targetStr = query.get('target');

  if (!targetStr) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing target URL' }));
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetStr);
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid target URL format' }));
    return;
  }

  // Security check: only allow authorized regional servers
  if (!ALLOWED_TARGET_HOSTS.has(targetUrl.host)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Host not permitted in relay' }));
    return;
  }

  const headers: Record<string, string | number | string[] | undefined> = {
    'User-Agent': 'Unified-Network-Monitor/1.0',
    'Cache-Control': 'no-store, no-cache',
    'Pragma': 'no-cache',
  };

  const options: https.RequestOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 8443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method || 'GET',
    headers,
    rejectUnauthorized: true,
  };

  if (req.method === 'GET' || req.method === 'HEAD') {
    const proxyReq = https.request(options, (proxyRes) => {
      res.statusCode = proxyRes.statusCode || 200;
      if (proxyRes.headers['content-type']) {
        res.setHeader('Content-Type', proxyRes.headers['content-type']);
      }
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: `Relay failed: ${err.message}` }));
      }
    });

    proxyReq.end();

    req.on('close', () => {
      proxyReq.destroy();
    });
  } else {
    // Forward POST payload chunks (upload speed test)
    const bodyChunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(bodyChunks);
      headers['content-length'] = body.length;
      if (req.headers['content-type']) {
        headers['content-type'] = req.headers['content-type'];
      }

      const proxyReq = https.request(options, (proxyRes) => {
        res.statusCode = proxyRes.statusCode || 200;
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
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

export function dispatchSpeedTestRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath === '/api/speedtest/relay') {
    handleRelay(req, res);
    return true;
  }
  return false;
}
