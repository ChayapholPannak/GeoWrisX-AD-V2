// One-off: verify the approve flow wrote device_commands on Neon MAIN.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envFile = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const lines = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

// strips optional surrounding quotes
const unquote = (v) => v.replace(/^"(.*)"$/, '$1');
const url = unquote(process.env.NEON_DATABASE_URL || lines.NEON_DATABASE_URL_MAIN || lines.NEON_DATABASE_URL);
const sql = neon(url);

const approvals = await sql`
  select id, compartment_no, status, ble_verified
     from public.pillbox_approvals
    order by requested_at desc limit 5`;
const commands = await sql`
  select approval_id, command_type, status, created_at
     from public.device_commands
    order by created_at desc limit 5`;

console.log('approvals:');
for (const a of approvals) console.log(' ', JSON.stringify(a));
console.log('device_commands:');
for (const c of commands) console.log(' ', JSON.stringify(c));
