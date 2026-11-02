/**
 * Simple cost-aware rate limiting for the device gateway, backed by the
 * free-plan Workers KV binding `RATE_LIMIT` (no card required).
 *
 * KV is eventual-consistent, so the counter is best-effort — enough to
 * blunt accidental firmware loops and internet scanners, not a strict
 * billing guarantee. When the binding is absent (e.g. local dev without
 * the namespace) the check is skipped so the gateway keeps working.
 */

import { HttpError } from './http.js';

const COUNTER_TTL = { minimumTtl: 61 };

async function currentBucket(env, key) {
  try {
    const value = await env.RATE_LIMIT.get(key);
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0; // missing binding / KV hiccup → fail open, never block devices
  }
}

/**
 * Throws HttpError(429) when the caller clears `limit` events per window.
 * `key` must already encode the tenant (device id, ip, …) and window kind.
 */
export async function enforceRateLimit(
  env,
  { key, limit, windowSeconds, message, now = Date.now() },
) {
  if (!env || !env.RATE_LIMIT || !key) return;
  const bucket = Math.floor(now / (windowSeconds * 1000));
  const fullKey = `${key}:${bucket}`;
  const count = await currentBucket(env, fullKey);
  if (count >= limit) {
    const retryIn = windowSeconds * 1000 - (now % (windowSeconds * 1000));
    const seconds = Math.max(1, Math.ceil(retryIn / 1000));
    throw new HttpError(429, `${message} (ลองใหม่อีกครั้งในอีกประมาณ ${seconds} วินาที)`);
  }
  try {
    await env.RATE_LIMIT.put(fullKey, String(count + 1), {
      expirationTtl: COUNTER_TTL.minimumTtl + windowSeconds,
    });
  } catch {
    /* fail open */
  }
}
