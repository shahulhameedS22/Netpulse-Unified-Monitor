/**
 * Vercel Serverless Function Entrypoint
 * 
 * Authoritative entrypoint for Vercel deployment.
 * Routes all /api/* requests to the unified Network Monitoring Express application.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../src/server/app.ts';

const app = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as any)(req, res);
}

