import { neon } from '@neondatabase/serverless';
import { HttpError } from './http.js';

let cachedClient = null;
let cachedUrl = '';

/**
 * Neon HTTP driver. Each `query()` is a stateless HTTPS request, which is the
 * right fit for Cloudflare Pages Functions (no TCP pooling in workerd).
 */
function getClient(env) {
  const url = env.NEON_DATABASE_URL;
  if (!url) {
    throw new HttpError(500, 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า NEON_DATABASE_URL');
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
