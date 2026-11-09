import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { assertMember, assertPrimary } from './_lib/access.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

const COLUMNS = `id, patient_id, title, place, detail, occurs_at, status, created_by, created_at`;

// อนุญาตทั้ง datetime-local (นาที โซนเวลาไหนก็ได้ แปป็น UTC ที่ระดับ client
// เป็นผู้กำหนด) และ ISO เต็ม — validate ว่าแปลงเป็นเวลาจริงได้เท่านั้น
function toIsoTimestamp(raw, field = 'เวลานัด') {
  if (typeof raw !== 'string' || !raw.trim()) throw new HttpError(400, `กรุณาระบุ${field}`);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${field}ไม่ถูกต้อง`);
  return date.toISOString();
}

function cleanText(value, { field, max, required = false }) {
  if (value === undefined || value === null || typeof value !== 'string') {
    if (required) throw new HttpError(400, `กรุณาระบุ${field}`);
    return undefined;
  }
  const text = value.trim().slice(0, max);
  if (required && text.length < 1) throw new HttpError(400, `${field}ห้ามว่าง`);
  return text.length ? text : undefined;
}

const STATUSES = new Set(['scheduled', 'done', 'canceled']);

/** GET /api/appointments?patient_id=... — appointments of one patient (member view). */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const patientId = requireUuid(url.searchParams.get('patient_id'), 'ต้องระบุ patient_id ให้ถูกต้อง');
  await assertMember(env, patientId, userId);

  const appointments = await query(
    env,
    `select ${COLUMNS}
       from public.patient_appointments
      where patient_id = $1
      order by occurs_at desc`,
    [patientId],
  );

  return json(200, { appointments });
});

/** POST /api/appointments — create (primary only). */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);

  const patientId = requireUuid(body.patient_id, 'ต้องระบุ patient_id ให้ถูกต้อง');
  await assertPrimary(env, patientId, userId);

  const title = cleanText(body.title, { field: 'หัวข้อนัดหมาย', max: 160, required: true });
  const place = cleanText(body.place, { field: 'สถานพยาบาล', max: 160, required: true });
  const detail = cleanText(body.detail, { field: 'หมายเหตุก่อนไป', max: 400 });
  const occursAt = toIsoTimestamp(body.occurs_at);

  const created = await queryOne(
    env,
    `insert into public.patient_appointments (patient_id, title, place, detail, occurs_at, created_by)
     values ($1, $2, $3, $4, $5, $6)
     returning ${COLUMNS}`,
    [patientId, title, place, detail ?? null, occursAt, userId],
  );

  return json(201, { appointment: created });
});

/** PATCH /api/appointments?id=... — edit fields or set status (primary only). */
export const onRequestPatch = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const id = requireUuid(url.searchParams.get('id'), 'ต้องระบุ id ของนัดหมาย');

  const existing = await queryOne(
    env,
    `select id, patient_id from public.patient_appointments where id = $1 limit 1`,
    [id],
  );
  if (!existing) throw new HttpError(404, 'ไม่พบนัดหมาย');
  await assertPrimary(env, existing.patient_id, userId);

  const body = await readJson(request);
  const sets = [];
  const params = [id];

  const title = cleanText(body.title, { field: 'หัวข้อนัดหมาย', max: 160 });
  if (title !== undefined) sets.push(`title = $${params.push(title)}`);

  const place = cleanText(body.place, { field: 'สถานพยาบาล', max: 160 });
  if (place !== undefined) sets.push(`place = $${params.push(place)}`);

  const detail = cleanText(body.detail, { field: 'หมายเหตุก่อนไป', max: 400 });
  if (detail !== undefined) {
    sets.push(`detail = $${params.push(detail)}`);
  } else if (typeof body.detail === 'string') {
    // ส่งค่าว่างมา = ล้างหมายเหตุ
    sets.push(`detail = null`);
  }

  if (body.occurs_at !== undefined) {
    sets.push(`occurs_at = $${params.push(toIsoTimestamp(body.occurs_at))}`);
  }

  if (typeof body.status === 'string') {
    if (!STATUSES.has(body.status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    sets.push(`status = $${params.push(body.status)}`);
  }

  if (sets.length === 0) throw new HttpError(400, 'ไม่มีค่าที่ต้องอัปเดต');

  const updated = await queryOne(
    env,
    `update public.patient_appointments set ${sets.join(', ')} where id = $1 returning ${COLUMNS}`,
    params,
  );

  return json(200, { appointment: updated });
});

/** DELETE /api/appointments?id=... — hard delete (primary only). */
export const onRequestDelete = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const id = requireUuid(url.searchParams.get('id'), 'ต้องระบุ id ของนัดหมาย');

  const existing = await queryOne(
    env,
    `select id, patient_id from public.patient_appointments where id = $1 limit 1`,
    [id],
  );
  if (!existing) throw new HttpError(404, 'ไม่พบนัดหมาย');
  await assertPrimary(env, existing.patient_id, userId);

  await queryOne(env, `delete from public.patient_appointments where id = $1 returning id`, [id]);

  return json(200, { ok: true, id, status: 'deleted' });
});
