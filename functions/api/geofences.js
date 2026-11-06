import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { assertMember, assertPrimary } from './_lib/access.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

const GEOFENCE_COLUMNS = `id, patient_id, label, kind, center_lat, center_lng, radius_m,
                          polygon, address, is_active, notify_all, created_by, created_at, updated_at`;

/** GET /api/geofences?patient_id=... — every circle/polygon saved for a patient. */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const patientId = requireUuid(url.searchParams.get('patient_id'), 'ต้องระบุ patient_id ให้ถูกต้อง');
  await assertMember(env, patientId, userId);

  const geofences = await query(
    env,
    `select ${GEOFENCE_COLUMNS}
       from public.geofences
      where patient_id = $1
      order by is_active desc, created_at desc`,
    [patientId],
  );

  return json(200, { geofences });
});

function validateShape(body) {
  const kind = body.kind === 'polygon' ? 'polygon' : 'circle';

  if (kind === 'circle') {
    const lat = Number(body.center_lat);
    const lng = Number(body.center_lng);
    const radius = Number(body.radius_m);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'center_lat ไม่ถูกต้อง');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, 'center_lng ไม่ถูกต้อง');
    if (!Number.isInteger(radius) || radius < 20 || radius > 50000) {
      throw new HttpError(400, 'รัศมีต้องอยู่ระหว่าง 20–50,000 เมตร');
    }
    return { kind, centerLat: lat, centerLng: lng, radiusM: radius, polygon: null };
  }

  // polygon: [[lat, lng], ...] with 3–64 vertices
  const poly = body.polygon;
  if (!Array.isArray(poly) || poly.length < 3 || poly.length > 64) {
    throw new HttpError(400, 'polygon ต้องมี 3–64 จุด');
  }
  const vertices = poly.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new HttpError(400, 'จุด polygon ต้องเป็น [lat, lng]');
    const [lat, lng] = [Number(pair[0]), Number(pair[1])];
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new HttpError(400, 'พิกัด polygon ไม่ถูกต้อง');
    }
    return [lat, lng];
  });
  return { kind, centerLat: null, centerLng: null, radiusM: null, polygon: JSON.stringify(vertices) };
}

/** POST /api/geofences — create a new safe-zone (primary only). */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);

  const patientId = requireUuid(body.patient_id, 'ต้องระบุ patient_id ให้ถูกต้อง');
  await assertPrimary(env, patientId, userId);

  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
  if (label.length < 1) throw new HttpError(400, 'กรุณาตั้งชื่อพื้นที่ปลอดภัย');
  const address = typeof body.address === 'string' ? body.address.trim().slice(0, 200) : '';
  const notifyAll = body.notify_all !== false;
  const shape = validateShape(body);

  const created = await queryOne(
    env,
    `insert into public.geofences
       (patient_id, label, kind, center_lat, center_lng, radius_m, polygon, address,
        notify_all, created_by)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     returning ${GEOFENCE_COLUMNS}`,
    [patientId, label, shape.kind, shape.centerLat, shape.centerLng, shape.radiusM,
     shape.polygon, address || null, notifyAll, userId],
  );

  return json(201, { geofence: created });
});

/** PATCH /api/geofences?id=... — rename / resize / activate / deactivate (primary only). */
export const onRequestPatch = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const id = requireUuid(url.searchParams.get('id'), 'ต้องระบุ id ของพื้นที่ปลอดภัย');

  const existing = await queryOne(
    env,
    `select id, patient_id from public.geofences where id = $1 limit 1`,
    [id],
  );
  if (!existing) throw new HttpError(404, 'ไม่พบพื้นที่ปลอดภัย');
  await assertPrimary(env, existing.patient_id, userId);

  const body = await readJson(request);
  const sets = [];
  const params = [id];

  if (typeof body.label === 'string') {
    const label = body.label.trim().slice(0, 80);
    if (label.length < 1) throw new HttpError(400, 'ชื่อพื้นที่ห้ามว่าง');
    sets.push(`label = $${params.push(label)}`);
  }
  if (typeof body.address === 'string') {
    sets.push(`address = $${params.push(body.address.trim().slice(0, 200) || null)}`);
  }
  if (body.radius_m !== undefined) {
    const radius = Number(body.radius_m);
    if (!Number.isInteger(radius) || radius < 20 || radius > 50000) {
      throw new HttpError(400, 'รัศมีต้องอยู่ระหว่าง 20–50,000 เมตร');
    }
    sets.push(`radius_m = $${params.push(radius)}`);
  }
  if (typeof body.notify_all === 'boolean') {
    sets.push(`notify_all = $${params.push(body.notify_all)}`);
  }
  if (typeof body.is_active === 'boolean') {
    sets.push(`is_active = $${params.push(body.is_active)}`);
  }

  if (sets.length === 0) throw new HttpError(400, 'ไม่มีค่าที่ต้องอัปเดต');
  sets.push('updated_at = now()');

  const updated = await queryOne(
    env,
    `update public.geofences set ${sets.join(', ')} where id = $1 returning ${GEOFENCE_COLUMNS}`,
    params,
  );

  return json(200, { geofence: updated });
});

/** DELETE /api/geofences?id=... — soft delete (is_active=false), primary only. */
export const onRequestDelete = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const id = requireUuid(url.searchParams.get('id'), 'ต้องระบุ id ของพื้นที่ปลอดภัย');

  const existing = await queryOne(
    env,
    `select id, patient_id, label from public.geofences where id = $1 limit 1`,
    [id],
  );
  if (!existing) throw new HttpError(404, 'ไม่พบพื้นที่ปลอดภัย');
  await assertPrimary(env, existing.patient_id, userId);

  await queryOne(
    env,
    `update public.geofences set is_active = false, updated_at = now() where id = $1 returning id`,
    [id],
  );

  return json(200, { ok: true, id, status: 'deactivated' });
});
