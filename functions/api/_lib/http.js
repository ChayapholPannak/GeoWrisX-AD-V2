/**
 * Small HTTP helpers shared by every Pages Function.
 *
 * Every /api route is wrapped with `route()` so validation failures
 * (HttpError) become clean JSON responses instead of stack traces.
 */

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

/** Wrap a handler so thrown errors become JSON instead of a 500 HTML page. */
export function route(handler) {
  return async function wrapped(context) {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof HttpError) {
        return json(error.status, { error: error.message });
      }
      console.error('Unhandled API error:', error?.stack || error?.message || error);
      return json(500, { error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง' });
    }
  };
}

export function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Resolve the CORS origin that is allowed to call the API.
 * Same-origin browser requests do not send `Origin`, so they need no header.
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  const allowlist = parseList(env.ALLOWED_ORIGINS);
  const requestOrigin = new URL(request.url).origin;
  const allowed = origin === requestOrigin || allowlist.includes(origin);

  if (!allowed) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-device-ingest-secret',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Guard for path/query parameters that must be UUIDs. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value, message) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new HttpError(400, message || 'รหัสอ้างอิงไม่ถูกต้อง');
  }
  return value;
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body;
  } catch {
    throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง');
  }
}

export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}
