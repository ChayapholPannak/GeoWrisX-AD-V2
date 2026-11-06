// Mock device — sends GPS_BATCH events to the real Device Gateway so the map
// and geofence pipeline can be verified without physical hardware.
//
// Usage (never prints the secret):
//   $env:TEST_DEVICE_ID = '<device uuid>'
//   $env:TEST_BASE_URL  = 'https://geowrisx-ad-v2.pages.dev'   (optional)
//   node scripts/mock-gps.mjs lat lng [count] [move_m]
//
// Example — walk 4 points drifting ~120 m east from a home geofence center:
//   node scripts/mock-gps.mjs 13.7367 100.5231 4 120

import { readFile } from 'node:fs/promises';

const [lat, lng, countArg, moveArg] = process.argv.slice(2);
const count = Number(countArg) || 3;
const move = Number(moveArg) || 0;

const deviceId = process.env.TEST_DEVICE_ID;
const baseUrl = process.env.TEST_BASE_URL || 'https://geowrisx-ad-v2.pages.dev';

if (!deviceId) {
  console.error('TEST_DEVICE_ID not set');
  process.exit(1);
}

// Read the ingest secret from .dev.vars without echoing it.
const envText = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const secret = /^DEVICE_INGEST_SECRET=(.+)$/m.exec(envText)?.[1]?.trim() || '';
if (!secret) {
  console.error('DEVICE_INGEST_SECRET not found in .dev.vars');
  process.exit(1);
}

let current = { lat: Number(lat), lng: Number(lng) };
if (!Number.isFinite(current.lat) || !Number.isFinite(current.lng)) {
  console.error('usage: node scripts/mock-gps.mjs lat lng [count] [move_m]');
  process.exit(1);
}

function uuid() {
  return globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) | (c === 'x' ? 0 : 8);
      return r.toString(16);
    });
}

const metersPerDegLat = 110_574;
const metersPerDegLng = Math.cos((current.lat * Math.PI) / 180) * 111_320;

const response = await fetch(`${baseUrl}/api/device-event`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-device-ingest-secret': secret,
  },
  body: JSON.stringify({
    event_type: 'GPS_BATCH',
    device_id: deviceId,
    points: Array.from({ length: count }, (_, i) => ({
      lat: Number((current.lat + (i * move) / metersPerDegLat).toFixed(6)),
      lng: Number((current.lng + (i * move) / metersPerDegLng).toFixed(6)),
      acc_m: 8 + Math.round(Math.random() * 6),
      speed_kmh: 1 + Math.round(Math.random() * 3),
      recorded_at: new Date(Date.now() - (count - i) * 60_000).toISOString(),
      client_ref: uuid(),
    })),
  }),
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
try {
  const parsed = JSON.parse(text);
  console.log(JSON.stringify(parsed, null, 2).replaceAll(/"recorded_at":"[^"]+"/g, '"recorded_at":"(iso)"'));
} catch {
  console.log(text.slice(0, 400));
}
