// One-off: verify the production rate limits on /api/device-event.
// Fires N DEVICE_STATUS events quickly; expects HTTP 429 once over quota.
import { readFileSync } from 'node:fs';

const envFile = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const lines = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const secret = lines.DEVICE_INGEST_SECRET;
const device = process.argv[2];
const total = Number(process.argv[3] || 70);

const results = [];
for (let i = 1; i <= total; i++) {
  const res = await fetch('https://geowrisx-ad-v2.pages.dev/api/device-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-ingest-secret': secret },
    body: JSON.stringify({ device_id: device, event_type: 'DEVICE_STATUS', status: 'online', battery_percent: 70 }),
  });
  const body = await res.text();
  results.push(res.status);
  if (res.status === 429 && !results.includes(429)) {
    console.log(`first 429 at call #${i}: ${body}`);
  }
}
const summary = results.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
console.log('banner distribution:', JSON.stringify(summary));
