// Diagnostic: mint a short-lived Clerk session token for a real user (dev instance)
// and call /api/track to find the real 404. Secrets read from .dev.vars, never printed.
// Usage: node scripts/diag-track.mjs [user_id_prefix]
import { readFile } from 'node:fs/promises';

const envText = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const secret = /^CLERK_SECRET_KEY=(.+)$/m.exec(envText)?.[1]?.trim() || '';
const instances = /^CLERK_INSTANCE_URL=(.+)$/m.exec(envText)?.[1]?.trim() || ''; // optional
const base = instances || 'https://api.clerk.com';
const userIdArg = process.argv[2] || '';

if (!secret) { console.error('CLERK_SECRET_KEY not found in .dev.vars'); process.exit(1); }
const authz = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };

const usersRes = await fetch(`${base}/v1/users?limit=10`, { headers: authz });
const users = await usersRes.json();
if (!usersRes.ok) { console.error('clerk list users failed:', usersRes.status, JSON.stringify(users).slice(0, 300)); process.exit(1); }
const list = Array.isArray(users) ? users : users?.data || [];
if (!list.length) { console.error('no users returned:', JSON.stringify(users).slice(0, 300)); process.exit(1); }

const target = list.find((u) => !userIdArg || u.id.includes(userIdArg));
if (!target) { console.error('user not found for', userIdArg, '— got:', list.map((u) => u.id).join(', ')); process.exit(1); }
console.log('user:', target.id);

// list sessions for that user
const sessRes = await fetch(`${base}/v1/sessions?user_id=${target.id}&limit=5`, { headers: authz });
const sess = await sessRes.json();
if (!sessRes.ok) { console.error('clerk list sessions failed:', sessRes.status); process.exit(1); }
const sessions = Array.isArray(sess) ? sess : sess?.data || [];
const session = sessions.find((s) => s.status === 'active') || sessions[0];
if (!session) {
  // No existing session: create one (development instances allow this)
  const createRes = await fetch(`${base}/v1/sessions`, {
    method: 'POST', headers: { ...authz },
    body: JSON.stringify({ user_id: target.id }),
  });
  console.log('create session:', createRes.status);
  const created = await createRes.json();
  console.log(JSON.stringify(created, null, 2).slice(0, 400));
  process.exit(0);
}
console.log('session:', session.id, session.status);

const tokenRes = await fetch(`${base}/v1/sessions/${session.id}/tokens`, {
  method: 'POST', headers: { ...authz, 'Content-Type': 'application/json' }, body: '{}',
});
const tok = await tokenRes.json();
if (!tokenRes.ok) { console.error('token failed:', tokenRes.status, JSON.stringify(tok).slice(0, 300)); process.exit(1); }
const jwt = tok.jwt || tok?.data?.jwt;
// Call production track API with a real patient from the DB
const patientId = 'c2cd25d1-1711-4bca-a3e5-61f8a6d6bde2';
const res = await fetch(`https://geowrisx-ad-v2.pages.dev/api/track?patient_id=${patientId}`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
console.log('/api/track:', res.status);
const body = await res.text();
console.log((body || '').slice(0, 400));
