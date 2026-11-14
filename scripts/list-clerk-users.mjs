// Read-only: list Clerk users (id, email, created, last sign-in) to compare with caregiver_links.
// Secrets read from .dev.vars, never printed.
import { readFile } from 'node:fs/promises';

const envText = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const secret = /^CLERK_SECRET_KEY=(.+)$/m.exec(envText)?.[1]?.trim() || '';
if (!secret) { console.error('CLERK_SECRET_KEY not found'); process.exit(1); }
const authz = { Authorization: `Bearer ${secret}` };

const res = await fetch('https://api.clerk.com/v1/users?limit=100&order_by=-last_sign_in_at', { headers: authz });
const body = await res.json();
if (!res.ok) { console.error('failed', res.status, JSON.stringify(body).slice(0, 200)); process.exit(1); }
const list = Array.isArray(body) ? body : body.data || [];
for (const u of list) {
  const primary = (u.email_addresses || []).find((e) => e.id === u.primary_email_address_id) || (u.email_addresses || [])[0];
  const signin = u.last_sign_in_at ? new Date(u.last_sign_in_at).toISOString() : 'never';
  const created = new Date(u.created_at).toISOString();
  console.log(`${u.id} · ${primary?.email_address || '(ไม่มีอีเมล)'} · loginล่าสุด ${signin} · สร้าง ${created}`);
}
