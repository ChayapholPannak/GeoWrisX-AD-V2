// One-off helper: exercise the production device-event gateway end-to-end.
import { readFileSync } from 'node:fs';

const envFile = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const lines = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const secret = lines.DEVICE_INGEST_SECRET;
const base = 'https://geowrisx-ad-v2.pages.dev/api/device-event';
const wristband = process.argv[2];
const pillbox = process.argv[3];

async function post(label, payload) {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-ingest-secret': secret },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  console.log(`[${res.status}] ${label}: ${JSON.stringify(data)}`);
}

await post('DEVICE_STATUS wristband', {
  device_id: wristband,
  event_type: 'DEVICE_STATUS',
  status: 'online',
  battery_percent: 72,
});
await post('DEVICE_STATUS pillbox', {
  device_id: pillbox,
  event_type: 'DEVICE_STATUS',
  status: 'online',
  battery_percent: 88,
});
await post('TAMPER wristband', {
  device_id: wristband,
  event_type: 'TAMPER',
  message: 'ทดสอบ: สายรัดถูกเปิดออก',
});
await post('LOW_BATTERY wristband', {
  device_id: wristband,
  event_type: 'LOW_BATTERY',
  battery_percent: 12,
  message: 'ทดสอบ: แบตใกล้หมด',
});
await post('PILLBOX_REQUEST BLE true', {
  device_id: pillbox,
  event_type: 'PILLBOX_REQUEST',
  compartment_no: 1,
  ble_proximity_verified: true,
});
await post('PILLBOX_REQUEST BLE false', {
  device_id: pillbox,
  event_type: 'PILLBOX_REQUEST',
  compartment_no: 2,
  ble_proximity_verified: false,
});
