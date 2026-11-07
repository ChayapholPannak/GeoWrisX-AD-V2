import { authenticate } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { assertMember } from './_lib/access.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

/**
 * PATCH /api/alerts?id=... — acknowledge an alert (any member may do it; the
 * caregiver who acted first stops the same incident from alerting again).
 */
export const onRequestPatch = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const id = requireUuid(url.searchParams.get('id'), 'ต้องระบุ id ของการแจ้งเตือน');

  const existing = await queryOne(
    env,
    `select id, patient_id, acknowledged_at from public.alerts where id = $1 limit 1`,
    [id],
  );
  if (!existing) throw new HttpError(404, 'ไม่พบการแจ้งเตือน');
  await assertMember(env, existing.patient_id, userId);

  const body = await readJson(request);
  if (body.acknowledged === false) {
    // Re-open (undo an accidental acknowledgement within the same circle).
    const updated = await queryOne(
      env,
      `update public.alerts set acknowledged_at = null where id = $1 returning id, acknowledged_at`,
      [id],
    );
    return json(200, { alert: updated });
  }

  const updated = await queryOne(
    env,
    `update public.alerts set acknowledged_at = now() where id = $1 returning id, acknowledged_at`,
    [id],
  );

  return json(200, { alert: updated });
});
