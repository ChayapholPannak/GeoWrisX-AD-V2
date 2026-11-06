import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { assertMember } from './_lib/access.js';
import { haversineM, pointInPolygon, circularGateState } from './_lib/geo.js';
import { HttpError, json, requireUuid, route } from './_lib/http.js';

/**
 * Geofence math lives in ./_lib/geo.js — the device gateway evaluates the same
 * gate state machine at ingest, so both sides stay in one mental model.
 */


/**
 * GET /api/track?patient_id=...&hours=24
 * Last-known position + recent track + active geofences + zone status.
 * Access: any member of the patient's care circle.
 */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const patientId = requireUuid(url.searchParams.get('patient_id'), 'ต้องระบุ patient_id ให้ถูกต้อง');
  await assertMember(env, patientId, userId);

  const hours = Math.min(Math.max(Number(url.searchParams.get('hours')) || 24, 1), 168);

  const [patient, points, fences] = await Promise.all([
    queryOne(
      env,
      `select id, display_name, is_archived from public.patients where id = $1 limit 1`,
      [patientId],
    ),
    query(
      env,
      `select id, lat, lng, acc_m, speed_kmh, recorded_at
         from public.gps_points
        where patient_id = $1 and recorded_at >= now() - ($2 || ' hours')::interval
        order by recorded_at asc
        limit 500`,
      [patientId, String(hours)],
    ),
    query(
      env,
      `select id, label, kind, center_lat, center_lng, radius_m, polygon, address, is_active, notify_all
         from public.geofences
        where patient_id = $1 and is_active = true
        order by created_at desc`,
      [patientId],
    ),
  ]);

  if (!patient) throw new HttpError(404, 'ไม่พบผู้ป่วย');

  const lastPoint = points.length ? points[points.length - 1] : null;

  // Status per active gate, evaluated solely from the last known position.
  const gateStatuses = [];
  if (lastPoint) {
    for (const fence of fences) {
      if (fence.kind === 'circle') {
        const distance = haversineM(lastPoint.lat, lastPoint.lng, fence.center_lat, fence.center_lng);
        gateStatuses.push({ id: fence.id, label: fence.label, kind: 'circle', distance_m: Math.round(distance), state: circularGateState(fence, distance) });
      } else {
        const poly = typeof fence.polygon === 'string' ? JSON.parse(fence.polygon) : fence.polygon;
        const inside = pointInPolygon(lastPoint.lat, lastPoint.lng, poly || []);
        gateStatuses.push({ id: fence.id, label: fence.label, kind: 'polygon', state: inside ? 'inside' : 'outside' });
      }
    }
  }

  const anyOutside = gateStatuses.some((g) => g.state === 'outside' || g.state === 'outside-hold');
  const status = !lastPoint ? 'unknown' : fences.length === 0 ? 'no_geofence' : anyOutside ? 'outside' : 'inside';

  // Marker for the latest breach alert so the UI can show "ออกนอกเขตเมื่อ X".
  const latestExit = await queryOne(
    env,
    `select id, message, occurred_at, acknowledged_at
       from public.alerts
      where patient_id = $1 and alert_type = 'GEOFENCE_EXIT'
      order by occurred_at desc
      limit 1`,
    [patientId],
  );

  return json(200, {
    patient: { id: patient.id, display_name: patient.display_name, is_archived: patient.is_archived },
    points,
    last_point: lastPoint,
    geofences: fences,
    gate_statuses: gateStatuses,
    status,
    latest_exit: latestExit,
    window_hours: hours,
  });
});
