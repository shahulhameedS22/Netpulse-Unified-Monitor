/**
 * Vercel Serverless Function Entrypoint
 * 
 * Authoritative entrypoint for Vercel deployment.
 * Routes all /api/* requests to the unified Network Monitoring Express application.
 */
import { createApiApp } from '../src/server/app';

const app = createApiApp();

export default app;
