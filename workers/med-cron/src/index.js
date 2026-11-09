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
  // ยิงสองงาน: ยาที่เลยเวลา (PILL_NOT_TAKEN) และเตือนนัดหมายล่วงหน้า 1 วัน / 3 ชม.
  const targets = [
    'https://geowrisx-ad-v2.pages.dev/api/cron/missed-meds',
    'https://geowrisx-ad-v2.pages.dev/api/cron/appointment-reminders',
  ];
  await Promise.allSettled(targets.map(async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-cron-secret': env.CRON_SECRET },
    });
    const body = await response.text();
    console.log(`[med-cron] ${url.split('/api/cron/')[1]}: HTTP ${response.status} ${(body || '').slice(0, 200)}`);
  }));
}
