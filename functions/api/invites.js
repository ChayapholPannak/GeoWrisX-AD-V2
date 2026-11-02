import { authenticate, findClerkUserByEmail, getClerkUser } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

/**
 * GET /api/invites — pending invites addressed to the signed-in user's email.
 * POST /api/invites { token } — accept one: links the caregiver as companion.
 */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const me = await getClerkUser(userId, env);
  if (!me?.email) return json(200, { invites: [] });

  const invites = await query(
    env,
    `select i.id as invite_id, i.token, i.email, i.expires_at,
            p.id as patient_id, p.display_name
       from public.caregiver_invites i
       join public.patients p on p.id = i.patient_id
      where i.status = 'pending'
        and i.expires_at > now()
        and lower(i.email) = lower($1)
      order by i.created_at desc`,
    [me.email],
  );

  return json(200, { invites });
});

export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);
  const token = String(body.token || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new HttpError(400, 'ลิงก์เชิญไม่ถูกต้อง');
  }

  const invite = await queryOne(
    env,
    `select i.id, i.email, i.status, i.expires_at, i.patient_id, i.created_by,
            p.display_name
       from public.caregiver_invites i
       join public.patients p on p.id = i.patient_id
      where i.token = $1
      limit 1`,
    [token],
  );
  if (!invite) throw new HttpError(404, 'ไม่พบลิงก์เชิญนี้');
  if (invite.status === 'accepted') throw new HttpError(409, 'ลิงก์นี้ถูกใช้แล้ว');
  if (invite.status !== 'pending') throw new HttpError(409, 'ลิงก์นี้ถูกยกเลิกหรือหมดอายุแล้ว');
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    throw new HttpError(409, 'คำเชิญหมดอายุ ขอลิงก์ใหม่จากเจ้าของหลัก');
  }

  const me = await getClerkUser(userId, env);
  if (!me?.email) throw new HttpError(500, 'หาบัญชีผู้ใช้ของคุณไม่พบ');

  if (me.email.toLowerCase() !== String(invite.email).toLowerCase()) {
    throw new HttpError(403, `คำเชิญฉบับนี้สำหรับอีเมล ${invite.email} เท่านั้น`);
  }

  // Guard against double-accept races: membership is the unique check.
  const existing = await queryOne(
    env,
    `select role from public.caregiver_links where patient_id = $1 and user_id = $2 limit 1`,
    [invite.patient_id, userId],
  );

  if (!existing) {
    await query(
      env,
      `insert into public.caregiver_links (patient_id, user_id, role, added_by)
       values ($1, $2, 'companion', $3)`,
      [invite.patient_id, userId, invite.created_by],
    );
  }

  await query(
    env,
    `update public.caregiver_invites
        set status = 'accepted', accepted_by = $1
      where id = $2`,
    [userId, invite.id],
  );

  return json(200, {
    ok: true,
    role: existing ? existing.role : 'companion',
    patient: { id: invite.patient_id, display_name: invite.display_name },
  });
});
