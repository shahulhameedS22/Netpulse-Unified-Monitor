/**
 * Vercel Serverless Function Entrypoint
 * 
 * Pre-bundled with esbuild into api/index.js during `npm run build`
 * to prevent [ERR_MODULE_NOT_FOUND] runtime errors on Vercel.
 */
import { createApiApp } from '../src/server/app';

const app = createApiApp();

export default app;
