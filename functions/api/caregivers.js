import { authenticate, findClerkUserByEmail } from './_lib/auth.js';
import { assertPrimary } from './_lib/access.js';
import { query, queryOne } from './_lib/db.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  }
  return email;
}

/** GET /api/caregivers?patient_id=<uuid> — members + pending invites (primary only). */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const patientId = requireUuid(
    new URL(request.url).searchParams.get('patient_id'),
    'รหัสผู้ป่วยไม่ถูกต้อง',
  );
  await assertPrimary(env, patientId, userId);

  const [members, invites] = await Promise.all([
    query(
      env,
      `select cl.user_id, cl.role, cl.created_at, cp.full_name
         from public.caregiver_links cl
        left join public.caregiver_profiles cp on cp.user_id = cl.user_id
        where cl.patient_id = $1
        order by cl.role desc, cl.created_at`,
      [patientId],
    ),
    query(
      env,
      `select id, email, status, created_at, expires_at
         from public.caregiver_invites
        where patient_id = $1 and status = 'pending' and expires_at > now()
        order by created_at desc`,
      [patientId],
    ),
  ]);

  return json(200, { members, invites });
});

/** POST /api/caregivers  { action: 'invite' | 'revoke' | 'remove', ... } */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);

  if (body.action === 'invite') {
    const patientId = requireUuid(body.patient_id, 'รหัสผู้ป่วยไม่ถูกต้อง');
    await assertPrimary(env, patientId, userId);
    const email = normalizeEmail(body.email);

    const patient = await queryOne(
      env,
      'select id, display_name from public.patients where id = $1 limit 1',
      [patientId],
    );
    if (!patient) throw new HttpError(404, 'ไม่พบผู้ป่วย');

    // If the email already belongs to a member (Clerk user already linked), say so.
    const existingUser = await findClerkUserByEmail(env, email);
    if (existingUser) {
      const already = await queryOne(
        env,
        'select 1 as ok from public.caregiver_links where patient_id = $1 and user_id = $2 limit 1',
        [patientId, existingUser.id],
      );
      if (already) throw new HttpError(409, 'ผู้ดูแลนี้อยู่ในทีมของผู้ป่วยรายนี้อยู่แล้ว');
    }

    // Expire stale pending rows first so the partial unique index frees up.
    await query(
      env,
      `update public.caregiver_invites
          set status = 'expired'
        where status = 'pending' and expires_at <= now()`,
    );

    // One live invite per patient+email (partial unique index enforces this).
    const pending = await queryOne(
      env,
      `select id from public.caregiver_invites
        where patient_id = $1 and lower(email) = lower($2) and status = 'pending'
        limit 1`,
      [patientId, email],
    );
    if (pending) {
      throw new HttpError(409, 'มีคำเชิญของอีเมลนี้ค้างอยู่ ยกเลิกก่อนแล้วเชิญใหม่ได้');
    }

    const invite = await queryOne(
      env,
      `insert into public.caregiver_invites (patient_id, email, created_by)
       values ($1, $2, $3)
       returning id, token, expires_at`,
      [patientId, email, userId],
    );

    return json(201, {
      invite: { id: invite.id, email, token: invite.token, expires_at: invite.expires_at },
      patient: { id: patient.id, display_name: patient.display_name },
    });
  }

  if (body.action === 'revoke') {
    const inviteId = requireUuid(body.invite_id, 'รหัสคำเชิญไม่ถูกต้อง');
    const invite = await queryOne(
      env,
      'select patient_id from public.caregiver_invites where id = $1 limit 1',
      [inviteId],
    );
    if (!invite) throw new HttpError(404, 'ไม่พบคำเชิญ');
    await assertPrimary(env, invite.patient_id, userId);
    await query(env, "update public.caregiver_invites set status = 'revoked' where id = $1", [inviteId]);
    return json(200, { ok: true });
  }

  if (body.action === 'remove') {
    const patientId = requireUuid(body.patient_id, 'รหัสผู้ป่วยไม่ถูกต้อง');
    await assertPrimary(env, patientId, userId);
    if (body.user_id === userId) throw new HttpError(400, 'หัวหน้าทีมต้องอยู่เสมอ ย้ายบทบาทก่อน');

    const member = await queryOne(
      env,
      `select 1 as ok
         from public.caregiver_links
        where patient_id = $1 and user_id = $2 and role = 'companion'`,
      [patientId, body.user_id],
    );
    if (!member) throw new HttpError(404, 'ไม่พบผู้ดูแลร่วมรายนี้');

    await query(
      env,
      `delete from public.caregiver_links
        where patient_id = $1 and user_id = $2 and role = 'companion'`,
      [patientId, body.user_id],
    );
    return json(200, { ok: true });
  }

  throw new HttpError(400, 'การทำงานไม่ถูกต้อง');
});
