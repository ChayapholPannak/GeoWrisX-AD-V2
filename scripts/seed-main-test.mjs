// One-off helper: seed a test patient + wristband + pillbox on Neon MAIN so the
// production device-event gateway can be exercised end-to-end.
// Owner is the real Clerk caregiver account, so the dashboard shows the data.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

// take NEON_DATABASE_URL (main) from .dev.vars.local-test or process env
const envFile = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const lines = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const url = process.env.NEON_DATABASE_URL || lines.NEON_DATABASE_URL_MAIN || lines.NEON_DATABASE_URL;
if (!url) throw new Error('no database url');
const sql = neon(url);

const OWNER = 'user_3LTLvStLfMRVt5SzSQhYNUHql8G';

// reuse existing test patient when present so reruns stay idempotent
let patient = (
  await sql`
    select id, display_name from public.patients
     where owner_id = ${OWNER} and display_name = 'ทดสอบ สายรัด' limit 1`
)[0];

if (!patient) {
  patient = (
    await sql`
      insert into public.patients (owner_id, display_name, relationship, date_of_birth)
      values (${OWNER}, 'ทดสอบ สายรัด', 'บุตร', '1958-04-12')
      returning id, display_name`
  )[0];
}

let wristband = (
  await sql`select id from public.devices where patient_id = ${patient.id} and device_type = 'wristband' limit 1`
)[0];
if (!wristband) {
  wristband = (
    await sql`
      insert into public.devices (patient_id, device_type, device_name, status, battery_percent)
      values (${patient.id}, 'wristband', 'สายรัดทดสอบ #1', 'offline', 60)
      returning id`
  )[0];
}

let pillbox = (
  await sql`select id from public.devices where patient_id = ${patient.id} and device_type = 'pillbox' limit 1`
)[0];
if (!pillbox) {
  pillbox = (
    await sql`
      insert into public.devices (patient_id, device_type, device_name, status, battery_percent)
      values (${patient.id}, 'pillbox', 'กล่องยาทดสอบ #1', 'offline', 90)
      returning id`
  )[0];
}

console.log(JSON.stringify({ patientId: patient.id, wristbandId: wristband.id, pillboxId: pillbox.id }));
