/**
 * Med-cron worker — pings the Pages function every 15 minutes to raise
 * PILL_NOT_TAKEN alerts for overdue medication schedules.
 *
 * Config: wrangler.toml (cron trigger) + CRON_SECRET via `wrangler secret put`.
 */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch() {
    return new Response('geowrisx med-cron: ok (cron only; use scheduled handler)');
  },
};

async function run(env) {
  if (!env.CRON_SECRET) {
    console.error('[med-cron] CRON_SECRET missing');
    return;
  }
  const response = await fetch('https://geowrisx-ad-v2.pages.dev/api/cron/missed-meds', {
    method: 'POST',
    headers: { 'x-cron-secret': env.CRON_SECRET },
  });
  const body = await response.text();
  console.log(`[med-cron] HTTP ${response.status} ${(body || '').slice(0, 200)}`);
}
