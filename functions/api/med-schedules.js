import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { assertMember, assertPrimary } from './_lib/access.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

const COLUMNS = `id, patient_id, label, time_of_day, compart_no, days, is_active, created_at`;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateBody(body) {
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : '';
  if (label.length < 1) throw new HttpError(400, 'กรุณาตั้งชื่อยา');

  const time = typeof body.time_of_day === 'string' ? body.time_of_day.trim() : '';
  if (!TIME_RE.test(time)) throw new HttpError(400, 'เวลาต้องอยู่ในรูปแบบ HH:MM');

  const compartNo = Number(body.compart_no);
  if (!Number.isInteger(compartNo) || compartNo < 1 || compartNo > 3) {
    throw new HttpError(400, 'compart_no ต้องอยู่ระหว่าง 1–3');
  }

  let days = [0, 1, 2, 3, 4, 5, 6]; // 0 = Sunday (JS getDay)
  if (Array.isArray(body.days) && body.days.length > 0) {
    days = [...new Set(body.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length === 0) throw new HttpError(400, 'days ต้องเป็นวัน 0–6');
  }

  return { label, time, compartNo, days };
}

/** GET /api/med-schedules?patient_id=... — every schedule (member view). */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const patientId = requireUuid(url.searchParams.get('patient_id'), 'ต้องระบุ patient_id ให้ถูกต้อง');
  await assertMember(env, patientId, userId);

  const schedules = await query(
    env,
    `select ${COLUMNS}
       from public.med_schedules
      where patient_id = $1
      order by is_active desc, time_of_day, created_at desc`,
    [patientId],
  );

  return json(200, { schedules });
});

/** POST /api/med-schedules — create (primary only). */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);

  const patientId = requireUuid(body.patient_id, 'ต้องระบุ patient_id ให้ถูกต้อง');
  await assertPrimary(env, patientId, userId);

  const v = validateBody(body);

  const created = await queryOne(
    env,
    `insert into public.med_schedules (patient_id, label, time_of_day, compart_no, days)
     values ($1, $2, $3, $4, $5)
     returning ${COLUMNS}`,
    [patientId, v.label, v.time, v.compartNo, v.days],
  );

  return json(201, { schedule: created });
});

/** PATCH /api/med-schedules?id=... — rename / retime / toggle (primary only). */
export const onRequestPatch = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const id = requireUuid(url.searchParams.get('id'), 'ต้องระบุ id ของเวลายา');

  const existing = await queryOne(
    env,
    `select id, patient_id from public.med_schedules where id = $1 limit 1`,
    [id],
  );
  if (!existing) throw new HttpError(404, 'ไม่พบเวลายา');
  await assertPrimary(env, existing.patient_id, userId);

  const body = await readJson(request);
  const sets = [];
  const params = [id];

  if (typeof body.label === 'string') {
    const label = body.label.trim().slice(0, 120);
    if (label.length < 1) throw new HttpError(400, 'ชื่อยาห้ามว่าง');
    sets.push(`label = $${params.push(label)}`);
  }
  if (typeof body.time_of_day === 'string') {
    const time = body.time_of_day.trim();
    if (!TIME_RE.test(time)) throw new HttpError(400, 'เวลาต้องอยู่ในรูปแบบ HH:MM');
    sets.push(`time_of_day = $${params.push(time)}`);
  }
  if (body.compart_no !== undefined) {
    const compartNo = Number(body.compart_no);
    if (!Number.isInteger(compartNo) || compartNo < 1 || compartNo > 3) {
      throw new HttpError(400, 'compart_no ต้องอยู่ระหว่าง 1–3');
    }
    sets.push(`compart_no = $${params.push(compartNo)}`);
  }
  if (Array.isArray(body.days) && body.days.length > 0) {
    const days = [...new Set(body.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length === 0) throw new HttpError(400, 'days ต้องเป็นวัน 0–6');
    sets.push(`days = $${params.push(days)}`);
  }
  if (typeof body.is_active === 'boolean') {
    sets.push(`is_active = $${params.push(body.is_active)}`);
  }

  if (sets.length === 0) throw new HttpError(400, 'ไม่มีค่าที่ต้องอัปเดต');

  const updated = await queryOne(
    env,
    `update public.med_schedules set ${sets.join(', ')} where id = $1 returning ${COLUMNS}`,
    params,
  );

  return json(200, { schedule: updated });
});

/** DELETE /api/med-schedules?id=... — hard delete (primary only; history rows keep schedule_id = null). */
export const onRequestDelete = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const id = requireUuid(url.searchParams.get('id'), 'ต้องระบุ id ของเวลายา');

  const existing = await queryOne(
    env,
    `select id, patient_id from public.med_schedules where id = $1 limit 1`,
    [id],
  );
  if (!existing) throw new HttpError(404, 'ไม่พบเวลายา');
  await assertPrimary(env, existing.patient_id, userId);

  await queryOne(env, `delete from public.med_schedules where id = $1 returning id`, [id]);

  return json(200, { ok: true, id, status: 'deleted' });
});
