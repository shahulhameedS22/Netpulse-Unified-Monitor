/**
 * Unified Network Monitoring - Full-Stack Local & Container Server
 * 
 * Supports:
 * 1. Local Development (`npm run dev`): Express API + Vite middleware on Port 3000
 * 2. Production Container / Cloud Run (`npm start`): Express API + Static build serving from dist/
 * 3. Vercel Serverless: via api/index.ts
 */

import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiApp, getRegionalEndpointUrl, runScheduledProbes } from './src/server/app.ts';
import { schedulerState } from './src/server/monitoring.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer() {
  const app = createApiApp();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    // Development mode: Mount Vite dev server middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve built static files from dist
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Automatic monitoring: run a probe round every MONITOR_INTERVAL_MIN minutes (0 / unset = off).
  // On Vercel (serverless) use a cron job that calls GET /api/monitor/run instead - see README.
  const intervalMin = Number(process.env.MONITOR_INTERVAL_MIN);
  if (Number.isFinite(intervalMin) && intervalMin >= 1) {
    schedulerState.intervalMin = intervalMin;
    const round = () =>
      runScheduledProbes()
        .then((r) => console.log('[monitor] round finished:', r.map((x) => `${x.region}=${x.status}`).join(' ')))
        .catch((e) => console.error('[monitor] round failed:', e?.message || e));
    setTimeout(round, 15_000); // first round shortly after start
    setInterval(round, intervalMin * 60_000);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Unified Network Monitor] Server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
    console.log(`[Unified Network Monitor] IN-DC01: ${getRegionalEndpointUrl('IN-DC01') || 'Unconfigured (default)'}`);
    console.log(`[Unified Network Monitor] IN-DC02: ${getRegionalEndpointUrl('IN-DC02') || 'Unconfigured (default)'}`);
    console.log(`[Unified Network Monitor] LK-DC01: ${getRegionalEndpointUrl('LK-DC01') || 'Unconfigured (default)'}`);
    console.log(`[Unified Network Monitor] SG-DC01: ${getRegionalEndpointUrl('SG-DC01') || 'Unconfigured (default)'}`);
  });
}

// Start if executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Fatal startup error in server.ts:', err);
    process.exit(1);
  });
}
