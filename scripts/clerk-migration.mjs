#!/usr/bin/env node
/**
 * Clerk development -> production user migration helper (GeoWrisX AD V2).
 *
 * Identity lives in two places: Clerk (login) and Neon (public.patients.owner_id,
 * public.caregiver_links.user_id, …). A new Clerk production instance issues new
 * `user_...` ids for the same people, so every reference in Neon has to be remapped
 * by email. This script inventories the current references, validates a mapping,
 * and applies it in one transaction per user.
 *
 * Usage:
 *   node scripts/clerk-migration.mjs inventory
 *   node scripts/clerk-migration.mjs plan  .migration/mapping.json
 *   node scripts/clerk-migration.mjs apply .migration/mapping.json          # dry run
 *   node scripts/clerk-migration.mjs apply .migration/mapping.json --apply  # write
 *
 * mapping.json:
 *   { "users": [ { "email": "a@example.com", "old_id": "user_old", "new_id": "user_new" } ] }
 *
 * Secrets are read from .dev.vars and never printed. Emails only ever go to the
 * git-ignored .migration/ folder.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

const ROOT = new URL('../', import.meta.url);
const ENV_FILE = new URL('.dev.vars', ROOT);
const OUT_DIR = new URL('.migration/', ROOT);

/** Columns that store a Clerk user id, in child-first order (see db/schema.sql). */
const USER_REFS = [
  { table: 'alerts', column: 'acknowledged_by', where: 'acknowledged_by is not null' },
  { table: 'pillbox_approvals', column: 'approved_by', where: 'approved_by is not null' },
  { table: 'caregiver_invites', column: 'created_by' },
  { table: 'geofences', column: 'created_by' },
  { table: 'patient_appointments', column: 'created_by' },
  { table: 'patients', column: 'owner_id' },
  { table: 'caregiver_links', column: 'user_id' },
  { table: 'caregiver_profiles', column: 'user_id' },
  { table: 'user_prefs', column: 'user_id' },
];

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

function databaseUrl(raw) {
  if (!raw) throw new Error('NEON_DATABASE_URL missing in .dev.vars');
  const url = new URL(raw);
  url.searchParams.delete('channel_binding');
  return url.toString();
}

function maskEmail(email) {
  if (!email) return '(no email)';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${(domain || '').split('.')[0].slice(0, 2)}***`;
}

async function listClerkUsers(secret) {
  if (!secret) throw new Error('CLERK_SECRET_KEY missing in .dev.vars');
  const users = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(
      `https://api.clerk.com/v1/users?limit=100&offset=${offset}&order_by=-created_at`,
      { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' } },
    );
    if (!response.ok) {
      throw new Error(`Clerk list users failed: ${response.status} ${await response.text().catch(() => '')}`.slice(0, 300));
    }
    const page = await response.json();
    const rows = Array.isArray(page) ? page : page.data || [];
    for (const user of rows) {
      const primary = (user.email_addresses || []).find((e) => e.id === user.primary_email_address_id)
        || (user.email_addresses || [])[0];
      users.push({
        id: user.id,
        email: primary?.email_address || '',
        name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim(),
        created_at: new Date(user.created_at).toISOString(),
        last_sign_in_at: user.last_sign_in_at ? new Date(user.last_sign_in_at).toISOString() : null,
      });
    }
    if (rows.length < 100) break;
  }
  return users;
}

async function countsFor(sql, oldId) {
  const out = [];
  for (const ref of USER_REFS) {
    const where = ref.where ? `${ref.where} and ${ref.column} = $1` : `${ref.column} = $1`;
    const rows = await sql.query(`select count(*)::int as n from public.${ref.table} where ${where}`, [oldId]);
    out.push({ ref: `${ref.table}.${ref.column}`, rows: rows[0]?.n ?? 0 });
  }
  return out;
}

async function inventory() {
  const env = parseEnv(await readFile(ENV_FILE, 'utf8'));
  const sql = neon(databaseUrl(env.NEON_DATABASE_URL));
  const users = await listClerkUsers(env.CLERK_SECRET_KEY);

  const report = [];
  for (const user of users) {
    report.push({ ...user, references: await countsFor(sql, user.id) });
  }

  await mkdir(OUT_DIR, { recursive: true });
  const file = new URL(`inventory-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, OUT_DIR);
  await writeFile(file, JSON.stringify({ generated_at: new Date().toISOString(), users: report }, null, 2));

  console.log(`Clerk users: ${users.length}`);
  for (const user of report) {
    const total = user.references.reduce((sum, item) => sum + item.rows, 0);
    const touched = user.references.filter((item) => item.rows > 0).map((item) => `${item.ref}=${item.rows}`);
    console.log(`- ${user.id}  ${maskEmail(user.email)}  last=${user.last_sign_in_at || 'never'}`);
    console.log(`  refs: ${total}${touched.length ? ` (${touched.join(', ')})` : ''}`);
  }
  console.log(`\nFull inventory (contains emails): ${file.pathname}`);
}

async function readMapping(path) {
  if (!path) throw new Error('mapping file required: .migration/mapping.json');
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const users = Array.isArray(parsed) ? parsed : parsed.users;
  if (!Array.isArray(users) || users.length === 0) throw new Error('mapping has no users[]');
  const seenOld = new Set();
  const seenNew = new Set();
  for (const [index, entry] of users.entries()) {
    const { old_id: oldId, new_id: newId } = entry;
    if (typeof oldId !== 'string' || !oldId.startsWith('user_')) throw new Error(`users[${index}].old_id invalid`);
    if (typeof newId !== 'string' || !newId.startsWith('user_')) throw new Error(`users[${index}].new_id invalid`);
    if (oldId === newId) throw new Error(`users[${index}] old_id and new_id are identical`);
    if (seenOld.has(oldId)) throw new Error(`duplicate old_id ${oldId}`);
    if (seenNew.has(newId)) throw new Error(`duplicate new_id ${newId}`);
    seenOld.add(oldId);
    seenNew.add(newId);
  }
  return users;
}

function migrationQueries(sql, oldId, newId) {
  const statements = [];
  for (const ref of USER_REFS) {
    if (ref.table === 'caregiver_links') {
      statements.push(sql.query(
        `insert into public.caregiver_links (patient_id, user_id, role)
         select patient_id, $2, role from public.caregiver_links where user_id = $1
         on conflict (patient_id, user_id) do update
           set role = case when public.caregiver_links.role = 'primary' then 'primary' else excluded.role end`,
        [oldId, newId],
      ));
      statements.push(sql.query('delete from public.caregiver_links where user_id = $1', [oldId]));
      continue;
    }
    if (ref.table === 'caregiver_profiles') {
      statements.push(sql.query(
        `insert into public.caregiver_profiles (user_id, full_name, phone, relationship_to_patient)
         select $2, full_name, phone, relationship_to_patient
           from public.caregiver_profiles where user_id = $1
         on conflict (user_id) do nothing`,
        [oldId, newId],
      ));
      statements.push(sql.query('delete from public.caregiver_profiles where user_id = $1', [oldId]));
      continue;
    }
    if (ref.table === 'user_prefs') {
      statements.push(sql.query(
        `insert into public.user_prefs (user_id, prefs)
         select $2, prefs from public.user_prefs where user_id = $1
         on conflict (user_id) do nothing`,
        [oldId, newId],
      ));
      statements.push(sql.query('delete from public.user_prefs where user_id = $1', [oldId]));
      continue;
    }
    statements.push(sql.query(
      `update public.${ref.table} set ${ref.column} = $2 where ${ref.column} = $1`,
      [oldId, newId],
    ));
  }
  return statements;
}

async function plan(users, apply = false) {
  const env = parseEnv(await readFile(ENV_FILE, 'utf8'));
  const sql = neon(databaseUrl(env.NEON_DATABASE_URL));
  const clerkUsers = await listClerkUsers(env.CLERK_SECRET_KEY);
  const byId = new Map(clerkUsers.map((user) => [user.id, user]));

  const planRows = [];
  for (const entry of users) {
    const oldUser = byId.get(entry.old_id);
    if (!oldUser) throw new Error(`old_id ${entry.old_id} does not exist in the current Clerk instance`);
    if (entry.email && oldUser.email && entry.email.toLowerCase() !== oldUser.email.toLowerCase()) {
      throw new Error(`email mismatch for ${entry.old_id}: mapping=${entry.email} clerk=${oldUser.email}`);
    }
    const references = await countsFor(sql, entry.old_id);
    planRows.push({ ...entry, email: entry.email || oldUser.email, old_name: oldUser.name, references });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(OUT_DIR, { recursive: true });
  const planFile = new URL(`plan-${stamp}.json`, OUT_DIR);
  await writeFile(planFile, JSON.stringify({ generated_at: new Date().toISOString(), apply, users: planRows }, null, 2));

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${planRows.length} user(s)`);
  for (const row of planRows) {
    console.log(`\n- ${row.email || '(no email)'}  ${row.old_id} -> ${row.new_id}`);
    for (const item of row.references) {
      if (item.rows > 0) console.log(`    ${item.ref}: ${item.rows}`);
    }
    const total = row.references.reduce((sum, item) => sum + item.rows, 0);
    if (total === 0) console.log('    (no database references yet)');
  }
  console.log(`\nPlan file: ${planFile.pathname}`);

  if (!apply) {
    console.log('Nothing written. Re-run with --apply after reviewing.');
    return;
  }

  for (const row of planRows) {
    await sql.transaction(migrationQueries(sql, row.old_id, row.new_id));
    const left = await countsFor(sql, row.old_id);
    const remaining = left.reduce((sum, item) => sum + item.rows, 0);
    if (remaining > 0) {
      throw new Error(`mapping ${row.old_id} -> ${row.new_id} left ${remaining} row(s) behind`);
    }
    console.log(`applied: ${row.old_id} -> ${row.new_id}`);
  }
  console.log('\nAll mappings applied.');
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'inventory') {
    await inventory();
  } else if (command === 'plan' || command === 'apply') {
    const users = await readMapping(args[0]);
    await plan(users, command === 'apply' && args.includes('--apply'));
  } else {
    console.log('Usage: node scripts/clerk-migration.mjs <inventory|plan|apply> [mapping.json] [--apply]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error('migration error:', error?.message || error);
  process.exitCode = 1;
}
