import { query } from './_lib/db.js';
import { route } from './_lib/http.js';

/**
 * GET /api/health
 * Unauthenticated readiness probe used by the deploy checklist.
 * Only booleans are returned — no connection strings or keys.
 */
export const onRequestGet = route(async ({ env }) => {
  const checks = {
    auth: Boolean(env.CLERK_SECRET_KEY || env.CLERK_JWT_KEY),
    database: false,
    storage: Boolean(env.FILES),
    email: Boolean(env.RESEND_API_KEY && env.RESEND_FROM),
    deviceGateway: Boolean(env.DEVICE_INGEST_SECRET),
  };

  let databaseError = null;
  if (env.NEON_DATABASE_URL) {
    try {
      await query(env, 'select 1 as ok');
      checks.database = true;
    } catch (error) {
      databaseError = 'connection-failed';
      console.error('Health check database error:', error?.message || error);
    }
  }

  const ok = checks.auth && checks.database && checks.storage;
  return new Response(
    JSON.stringify({
      ok,
      service: 'geowrisx-ad-v2',
      time: new Date().toISOString(),
      checks,
      ...(databaseError ? { databaseError } : {}),
    }),
    {
      status: ok ? 200 : 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
});
