// Mock care payload — sends SLEEP_SUMMARY / HR_BATCH / MED_EVENT events to the
// real Device Gateway so the care-log pipeline can be verified without hardware.
//
// Usage (never prints secrets):
//   $env:TEST_DEVICE_ID = '<device uuid>'        # wristband lets hr/sleep, pillbox lets med
//   $env:TEST_BASE_URL  = 'https://geowrisx-ad-v2.pages.dev'  (optional)
//   $env:TEST_SCHEDULE_ID = '<schedule uuid>'    (optional, MED_EVENT taken)
//   node scripts/mock-care.mjs sleep | hr | med [count]

import { readFile } from 'node:fs/promises';

const [kind, countArg] = process.argv.slice(2);
const count = Math.min(Number(countArg) || 7, 30);

const deviceId = process.env.TEST_DEVICE_ID;
const baseUrl = process.env.TEST_BASE_URL || 'https://geowrisx-ad-v2.pages.dev';
if (!deviceId) { console.error('TEST_DEVICE_ID not set'); process.exit(1); }

const envText = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const secret = /^DEVICE_INGEST_SECRET=(.+)$/m.exec(envText)?.[1]?.trim() || '';
if (!secret) { console.error('DEVICE_INGEST_SECRET not found in .dev.vars'); process.exit(1); }

function uuid() {
  return globalThis.crypto.randomUUID();
}
function thDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function build(kind, i) {
  if (kind === 'sleep') {
    // Nightly summary: asleep 22:30 -> woke 07:15 (Thai time), 1–3% disorder.
    const day = i; // i = 0 -> last night ... count-1
    const awakeAtBase = Date.now() - (day + 1) * 86400000;
    const asleepAt = new Date(awakeAtBase).toISOString().slice(0, 11) + '22:30:00+07:00';
    const wokeAt = new Date(Date.now() - day * 86400000).toISOString().slice(0, 11) + '07:15:00+07:00';
    return {
      event_type: 'SLEEP_SUMMARY',
      device_id: deviceId,
      night_date: thDate(-day),
      asleep_at: asleepAt,
      woke_at: wokeAt,
      restless_min: 15 + Math.floor(Math.random() * 40),
      awake_min: 5 + Math.floor(Math.random() * 25),
      quality: ['good', 'good', 'fair', 'poor'][Math.floor(Math.random() * 4)],
      client_ref: `mock-sleep-${thDate(-day)}-${uuid().slice(0, 8)}`,
    };
  }
  if (kind === 'hr') {
    const n = count;
    return {
      event_type: 'HR_BATCH',
      device_id: deviceId,
      samples: Array.from({ length: n }, (_, k) => ({
        bpm: 68 + Math.round(Math.sin(k / 3) * 7 + Math.random() * 5),
        spo2: 97,
        recorded_at: new Date(Date.now() - (n - k) * 1800_000).toISOString(),
        client_ref: `mock-hr-${uuid().slice(0, 8)}`,
      })),
    };
  }
  // med
  const schedule = process.env.TEST_SCHEDULE_ID || null;
  return {
    event_type: 'MED_EVENT',
    device_id: deviceId,
    action: 'taken',
    schedule_id: schedule,
    compartment_no: schedule ? 1 : 2,
    weight_g: 0.5,
    taken_at: new Date(Date.now() - i * 3600_000).toISOString(),
    client_ref: `mock-med-${uuid().slice(0, 8)}`,
  };
}

const events = kind === 'sleep' || kind === 'hr' || kind === 'med'
  ? Array.from({ length: kind === 'hr' ? 1 : count }, (_, i) => build(kind, i))
  : null;
if (!events) { console.error('usage: node scripts/mock-care.mjs sleep|hr|med [count]'); process.exit(1); }

let ok = 0;
let failed = 0;
for (const payload of events) {
  const response = await fetch(`${baseUrl}/api/device-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-ingest-secret': secret },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (response.ok) { ok += 1; } else { failed += 1; }
  if (failed || events.length === 1) {
    console.log(`HTTP ${response.status} ${payload.event_type} ${payload.night_date || ''}`);
    if (!response.ok) console.log(text.slice(0, 300));
  }
}
console.log(`done: ok=${ok} failed=${failed}`);
