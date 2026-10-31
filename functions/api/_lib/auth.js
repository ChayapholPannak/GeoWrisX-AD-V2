import { verifyToken } from '@clerk/backend';
import { HttpError, parseList } from './http.js';

/**
 * Verify the Clerk session token sent as `Authorization: Bearer <token>`.
 *
 * Verification uses CLERK_JWT_KEY (networkless, preferred) when available and
 * falls back to CLERK_SECRET_KEY + Clerk's JWKS endpoint. `authorizedParties`
 * blocks tokens minted for a different frontend origin.
 */
export async function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'กรุณาเข้าสู่ระบบก่อนใช้งาน');

  const secretKey = env.CLERK_SECRET_KEY;
  const jwtKey = env.CLERK_JWT_KEY;

  if (!secretKey && !jwtKey) {
    throw new HttpError(500, 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Clerk (CLERK_SECRET_KEY หรือ CLERK_JWT_KEY)');
  }

  const authorizedParties = parseList(env.CLERK_AUTHORIZED_PARTIES);

  let claims;
  try {
    claims = await verifyToken(token, {
      ...(jwtKey ? { jwtKey } : { secretKey }),
      ...(authorizedParties.length ? { authorizedParties } : {}),
    });
  } catch (error) {
    console.error('Clerk token verification failed:', error?.message || error);
    throw new HttpError(401, 'เซสชันหมดอายุหรือ Token ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  }

  if (!claims?.sub) {
    throw new HttpError(401, 'Token ไม่มีข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่');
  }

  return {
    userId: claims.sub,
    sessionId: claims.sid || null,
    claims,
  };
}

const userCache = new Map();
const USER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Clerk session tokens do not contain the user's email address, so profile and
 * alert emails are resolved through the Clerk Backend API (cached per isolate).
 */
export async function getClerkUser(userId, env) {
  if (!env.CLERK_SECRET_KEY) return { email: '', fullName: '' };

  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      console.error('Clerk user lookup failed:', response.status, await response.text().catch(() => ''));
      return { email: '', fullName: '' };
    }
    const data = await response.json();
    const primary = (data.email_addresses || []).find((item) => item.id === data.primary_email_address_id);
    const value = {
      email: (primary || data.email_addresses?.[0] || {}).email_address || '',
      fullName: [data.first_name, data.last_name].filter(Boolean).join(' ').trim(),
    };
    userCache.set(userId, { value, expiresAt: Date.now() + USER_CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.error('Clerk user lookup error:', error?.message || error);
    return { email: '', fullName: '' };
  }
}

/**
 * Constant-time-ish comparison for the prototype device gateway secret.
 * Cloudflare Workers have no node:crypto timingSafeEqual, so compare digests.
 */
export async function secretsMatch(supplied, expected) {
  if (!supplied || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
