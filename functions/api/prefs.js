import { authenticate } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { HttpError, json, readJson, route } from './_lib/http.js';

/**
 * Per-user UI/notification preferences, stored as a JSONB blob.
 * The blob is opaque to the backend — the Settings menu owns its shape —
 * but we still guard size (8 KB) and reject non-JSON-object payloads so a
 * runaway client cannot bloat the row.
 */

const PREFS_COLUMNS = `user_id, prefs, updated_at`;
const MAX_PREFS_BYTES = 8192;

/** GET /api/prefs — returns the caller's prefs, {} when never saved before. */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);

  const row = await queryOne(
    env,
    `select ${PREFS_COLUMNS} from public.user_prefs where user_id = $1 limit 1`,
    [userId],
  );

  return json(200, {
    prefs: row?.prefs ?? {},
    updated_at: row?.updated_at ?? null,
  });
});

/** PUT /api/prefs — merge-style upsert of the whole prefs object. */
export const onRequestPut = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);

  if (!body.prefs || typeof body.prefs !== 'object' || Array.isArray(body.prefs)) {
    throw new HttpError(400, 'prefs ต้องเป็น object เท่านั้น');
  }

  const prefsJson = JSON.stringify(body.prefs);
  if (prefsJson.length > MAX_PREFS_BYTES) {
    throw new HttpError(413, 'การตั้งค่าใหญ่เกินไป (จำกัด 8 KB)');
  }

  const row = await queryOne(
    env,
    `insert into public.user_prefs (user_id, prefs, updated_at)
       values ($1, $2::jsonb, now())
     on conflict (user_id) do update
       set prefs = $2::jsonb,
           updated_at = now()
     returning ${PREFS_COLUMNS}`,
    [userId, prefsJson],
  );

  return json(200, { prefs: row.prefs, updated_at: row.updated_at });
});
