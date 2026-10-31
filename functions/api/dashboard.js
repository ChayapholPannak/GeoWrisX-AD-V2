import { authenticate } from './_lib/auth.js';
import { query } from './_lib/db.js';
import { json, route } from './_lib/http.js';

/**
 * GET /api/dashboard
 * Returns everything the caregiver console renders. Ownership is enforced by
 * joining `patients` on the Clerk user id instead of relying on database RLS.
 */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);

  const patients = await query(
    env,
    `select p.id,
            p.display_name,
            p.relationship,
            to_char(p.date_of_birth, 'YYYY-MM-DD') as date_of_birth,
            p.is_archived,
            p.created_at,
            p.updated_at
       from public.patients p
      where p.owner_id = $1
      order by p.created_at desc
      limit 200`,
    [userId],
  );

  if (patients.length === 0) {
    return json(200, {
      patients: [],
      devices: [],
      alerts: [],
      approvals: [],
      commands: [],
      files: [],
    });
  }

  const [devices, alerts, approvals, commands, files] = await Promise.all([
    query(
      env,
      `select d.id, d.patient_id, d.device_type, d.device_name, d.status,
              d.battery_percent, d.last_seen_at, d.created_at
         from public.devices d
         join public.patients p on p.id = d.patient_id
        where p.owner_id = $1
        order by d.created_at desc
        limit 200`,
      [userId],
    ),
    query(
      env,
      `select a.id, a.patient_id, a.device_id, a.alert_type, a.severity,
              a.message, a.occurred_at, a.acknowledged_at
         from public.alerts a
         join public.patients p on p.id = a.patient_id
        where p.owner_id = $1
        order by a.occurred_at desc
        limit 20`,
      [userId],
    ),
    query(
      env,
      `select a.id, a.patient_id, a.compartment_no, a.status, a.ble_verified,
              a.requested_at, a.expires_at, a.approved_at
         from public.pillbox_approvals a
         join public.patients p on p.id = a.patient_id
        where p.owner_id = $1
        order by a.requested_at desc
        limit 20`,
      [userId],
    ),
    query(
      env,
      `select c.id, c.patient_id, c.command_type, c.compartment_no, c.status,
              c.created_at, c.expires_at
         from public.device_commands c
         join public.patients p on p.id = c.patient_id
        where p.owner_id = $1
        order by c.created_at desc
        limit 10`,
      [userId],
    ),
    query(
      env,
      `select f.id, f.patient_id, f.file_name, f.content_type,
              f.size_bytes::int as size_bytes, f.created_at
         from public.patient_files f
         join public.patients p on p.id = f.patient_id
        where p.owner_id = $1
        order by f.created_at desc
        limit 200`,
      [userId],
    ),
  ]);

  return json(200, { patients, devices, alerts, approvals, commands, files });
});
