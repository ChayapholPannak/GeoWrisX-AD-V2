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
  try {
    return await getClient(env).query(text, params);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Neon scale-to-zero wakes on the first query; a cold connection can fail
    // with a network-level error. Surface it as a retryable 503 instead of a
    // generic 500 so the client can wait a moment and try again.
    if (isTransientDbError(error)) {
      console.error('Database transient error:', error?.message || error);
      throw new HttpError(503, 'ฐานข้อมูลกำลังตื่นจากการพัก กรุณาลองใหม่อีกครั้งในอีก 2–3 วินาที');
    }
    throw error;
  }
}

const TRANSIENT_DB_RE = /(fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|terminating connection|connection terminated|connection timeout|timed out|timeout expired|NeonDbError[^]*connect)/i;

function isTransientDbError(error) {
  const text = `${error?.name || ''} ${error?.message || ''} ${error?.code || ''}`;
  return TRANSIENT_DB_RE.test(text);
}

/** Convenience helper for queries that must return exactly one row. */
export async function queryOne(env, text, params = []) {
  const rows = await query(env, text, params);
  return rows[0] || null;
}
