import { corsHeaders } from './_lib/http.js';

/**
 * Applies to every /api/* Pages Function.
 * - Answers CORS preflight once, with an origin allowlist.
 * - Adds hardening headers to every API response (including errors).
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export async function onRequest(context) {
  const { request, env, next } = context;
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    if (origin && !cors['Access-Control-Allow-Origin']) {
      return new Response(JSON.stringify({ error: 'Origin นี้ไม่ได้รับอนุญาตให้เรียก API' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
      });
    }
    return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
  }

  const response = await next();
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  if (response.status === 204 || response.status === 304 || !response.body) {
    return new Response(null, { status: response.status, headers });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
