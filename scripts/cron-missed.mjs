// Manual trigger for the missed-meds cron (uses CRON_SECRET from .dev.vars; never prints it).
// Usage: $env:TEST_BASE_URL optional, then: node scripts/cron-missed.mjs
import { readFile } from 'node:fs/promises';

const baseUrl = process.env.TEST_BASE_URL || 'https://geowrisx-ad-v2.pages.dev';
const envText = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const secret = /^CRON_SECRET=(.+)$/m.exec(envText)?.[1]?.trim() || '';
if (!secret) { console.error('CRON_SECRET not found in .dev.vars'); process.exit(1); }

const response = await fetch(`${baseUrl}/api/cron/missed-meds`, {
  method: 'POST',
  headers: { 'x-cron-secret': secret },
});
console.log(`HTTP ${response.status}`);
console.log(await response.text());
