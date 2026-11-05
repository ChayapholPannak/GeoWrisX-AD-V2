import { neon } from '@neondatabase/serverless';
import { HttpError } from './http.js';

let cachedClient = null;
let cachedUrl = '';

/**
 * Neon HTTP driver. Each `query()` is a stateless HTTPS request, which is the
 * right fit for Cloudflare Pages Functions (no TCP pooling in workerd).
 */
function getClient(env) {
  let url = env.NEON_DATABASE_URL;
  if (!url) {
    throw new HttpError(500, 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า NEON_DATABASE_URL');
  }
  // @neondatabase/serverless rejects URLs with query params it does not
  // understand — and its error message prints the full string (including the
  // password). Strip such params before handing the URL over.
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('channel_binding');
    url = parsed.toString();
  } catch {
    throw new HttpError(500, 'NEON_DATABASE_URL รูปแบบไม่ถูกต้อง');
  }
  if (!cachedClient || cachedUrl !== url) {
    cachedClient = neon(url);
    cachedUrl = url;
  }
  return cachedClient;
}

/** Parameterised query ($1, $2, ...) returning the rows array. */
export async function query(env, text, params = []) {
  return getClient(env).query(text, params);
}

/** Convenience helper for queries that must return exactly one row. */
export async function queryOne(env, text, params = []) {
  const rows = await query(env, text, params);
  return rows[0] || null;
}
