import { getClerkUser, secretsMatch } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { buildAlertEmail, buildPillboxRequestEmail, sendEmail } from './_lib/email.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';
import { enforceRateLimit } from './_lib/ratelimit.js';

const ALLOWED_EVENTS = new Set([
  'GEOFENCE_EXIT',
  'TAMPER',
  'LOW_BATTERY',
  'BLE_DISCONNECTED',
  'DEVICE_STATUS',
  'PILLBOX_REQUEST',
]);

const ALERT_MESSAGES = {
  GEOFENCE_EXIT: 'สายรัดตรวจพบการออกนอกพื้นที่ที่กำหนด',
  TAMPER: 'ตรวจพบการเปิดหรือถอดสายรัด',
  LOW_BATTERY: 'แบตเตอรี่อุปกรณ์ใกล้หมด',
  BLE_DISCONNECTED: 'การเชื่อมต่อ BLE ขาดหาย',
};

/** Best-effort email to every caregiver of the patient; never blocks ingest. */
async function notify(env, patientId, builder, values) {
  try {
    if (env.ALERT_NOTIFY_TO) {
      await sendEmail(env, { to: env.ALERT_NOTIFY_TO, ...builder(values) });
      return;
    }

    // One email per member of the patient circle (dedup recipients).
    const members = await query(
      env,
      `select distinct user_id from public.caregiver_links where patient_id = $1`,
      [patientId],
    );
    const tos = [];
    for (const m of members) {
      const user = await getClerkUser(m.user_id, env);
      if (user.email && !tos.includes(user.email)) tos.push(user.email);
    }
    for (const to of tos) {
      await sendEmail(env, { to, ...builder(values) });
    }
  } catch (error) {
    console.error('Notification email failed:', error?.message || error);
  }
}

/**
 * POST /api/device-event
 * Prototype hardware gateway. Authenticated with a shared secret only — replace
 * with per-device credentials and replay protection before real deployments.
 */
export const onRequestPost = route(async ({ request, env, waitUntil }) => {
  // Hard-cap request size: legitimate events are tiny JSON, never > 8 KiB.
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 8192) {
    throw new HttpError(413, 'ข้อมูลเหตุการณ์ใหญ่เกินที่อนุญาต');
  }

  const clientIp = request.headers.get('Cf-Connecting-Ip') || 'unknown';

  const expectedSecret = env.DEVICE_INGEST_SECRET;
  const suppliedSecret = request.headers.get('x-device-ingest-secret');
  if (!(await secretsMatch(suppliedSecret, expectedSecret))) {
    // Brute-force guard: a handful of bad attempts per IP per 15 minutes.
    await enforceRateLimit(env, {
      key: `auth-fail:${clientIp}`,
      limit: 20,
      windowSeconds: 15 * 60,
      message: 'อัตราการลองเชื่อมต่อสูงผิดปกติ ถูกชะลอชั่วคราว',
    });
    throw new HttpError(401, 'อุปกรณ์ไม่ได้รับอนุญาต');
  }

  // Firmware sanity cap per source IP: far above any real cadence, catches runaway loops.
  await enforceRateLimit(env, {
    key: `ingest-ip:${clientIp}`,
    limit: 60,
    windowSeconds: 60,
    message: 'ยอดเหตุการณ์จากอุปกรณ์เกินโควตาชั่วคราว',
  });

  const body = await readJson(request);
  if (!ALLOWED_EVENTS.has(body.event_type)) {
    throw new HttpError(400, 'ชนิดเหตุการณ์ไม่ถูกต้อง');
  }
  const deviceId = requireUuid(body.device_id, 'รหัสอุปกรณ์ไม่ถูกต้อง');

  const device = await queryOne(
    env,
    `select d.id, d.patient_id, d.device_type, d.device_name,
            p.owner_id, p.display_name as patient_name
       from public.devices d
       join public.patients p on p.id = d.patient_id
      where d.id = $1
      limit 1`,
    [deviceId],
  );
  if (!device) throw new HttpError(404, 'ไม่พบอุปกรณ์');

  // Per-device quota (in addition to the per-IP one above).
  await enforceRateLimit(env, {
    key: `device:${device.id}`,
    limit: 30,
    windowSeconds: 60,
    message: 'ยอดเหตุการณ์จากอุปกรณ์นี้เกินโควตาชั่วคราว',
  });

  if (body.event_type === 'DEVICE_STATUS') {
    const battery = Number(body.battery_percent);
    if (!Number.isInteger(battery) || battery < 0 || battery > 100) {
      throw new HttpError(400, 'battery_percent ต้องเป็นจำนวนเต็ม 0–100');
    }
    await query(
      env,
      `update public.devices
          set status = $2, battery_percent = $3, last_seen_at = now()
        where id = $1`,
      [device.id, body.status === 'online' ? 'online' : 'offline', battery],
    );
    return json(200, { ok: true, event: 'DEVICE_STATUS' });
  }

  if (body.event_type === 'PILLBOX_REQUEST') {
    const compartment = Number(body.compartment_no);
    if (!Number.isInteger(compartment) || compartment < 1 || compartment > 3) {
      throw new HttpError(400, 'compartment_no ต้องอยู่ระหว่าง 1–3');
    }

    // Each request emails the caregiver — keep the mail queue from filling up.
    await enforceRateLimit(env, {
      key: `pillbox-req:${device.id}`,
      limit: 5,
      windowSeconds: 60,
      message: 'คำขอเปิดกล่องยาจากอุปกรณ์นี้ถี่เกินไป',
    });

    // Firmware must set this true only after the pillbox verifies the wristband over BLE.
    const bleVerified = body.ble_proximity_verified === true;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const approval = await queryOne(
      env,
      `insert into public.pillbox_approvals
         (patient_id, compartment_no, status, ble_verified, expires_at)
       values ($1, $2, 'pending', $3, $4::timestamptz)
       returning id, status, ble_verified, requested_at, expires_at`,
      [device.patient_id, compartment, bleVerified, expiresAt],
    );

    waitUntil(
      notify(env, device.patient_id, buildPillboxRequestEmail, {
        patientName: device.patient_name,
        compartmentNo: compartment,
        expiresAt,
        bleVerified,
      }),
    );

    return json(201, { ok: true, approval });
  }

  const severity = body.event_type === 'TAMPER' || body.event_type === 'GEOFENCE_EXIT' ? 'critical' : 'warning';
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 300)
    : ALERT_MESSAGES[body.event_type];

  const alert = await queryOne(
    env,
    `insert into public.alerts (patient_id, device_id, alert_type, severity, message)
     values ($1, $2, $3, $4, $5)
     returning id, alert_type, severity, message, occurred_at, acknowledged_at`,
    [device.patient_id, device.id, body.event_type, severity, message],
  );

  waitUntil(
    notify(env, device.patient_id, buildAlertEmail, {
      patientName: device.patient_name,
      deviceName: device.device_name,
      message,
      severity,
      occurredAt: alert.occurred_at,
    }),
  );

  return json(201, { ok: true, alert });
});
