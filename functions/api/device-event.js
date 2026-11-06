import { getClerkUser, secretsMatch } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { buildAlertEmail, buildPillboxRequestEmail, sendEmail } from './_lib/email.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';
import { enforceRateLimit } from './_lib/ratelimit.js';
import { haversineM, pointInPolygon } from './_lib/geo.js';

const ALLOWED_EVENTS = new Set([
  'GEOFENCE_EXIT',
  'TAMPER',
  'LOW_BATTERY',
  'BLE_DISCONNECTED',
  'DEVICE_STATUS',
  'PILLBOX_REQUEST',
  'GPS_BATCH',
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
 * Hysteresis re-entry: a gate requires an outside streak of >= 2 GPS points
 * spanning >= 60 s (margin handled by circularGateState) before it counts as
 * a breach. Repeats for the same fence are suppressed until the open alert is
 * acknowledged.
 */
async function gateBreach(env, device, fence) {
  const history = await query(
    env,
    `select lat, lng, recorded_at
       from public.gps_points
      where patient_id = $1
      order by recorded_at desc
      limit 30`,
    [device.patient_id],
  );
  const points = history.reverse(); // oldest -> newest

  const radius = fence.kind === 'circle' ? Number(fence.radius_m) || 0 : null;
  const poly = fence.kind === 'polygon'
    ? (typeof fence.polygon === 'string' ? JSON.parse(fence.polygon) : fence.polygon)
    : null;

  let streak = 0;
  let firstOutsideAt = 0;
  let lastOutside = null;

  for (const pt of points) {
    let state;
    if (fence.kind === 'circle') {
      const distance = haversineM(pt.lat, pt.lng, fence.center_lat, fence.center_lng);
      state = circularGateState({ radius_m: radius }, distance);
    } else {
      state = pointInPolygon(pt.lat, pt.lng, poly || []) ? 'inside' : 'outside';
    }
    if (state === 'inside') {
      streak = 0;
      firstOutsideAt = 0;
    } else if (state === 'edge') {
      // Hysteresis band — hold the current streak untouched.
    } else {
      const at = new Date(pt.recorded_at).getTime();
      if (streak === 0) firstOutsideAt = at;
      streak += 1;
      lastOutside = pt;
    }
  }

  const lastAt = lastOutside ? new Date(lastOutside.recorded_at).getTime() : 0;
  if (streak < 2 || !lastOutside || lastAt - firstOutsideAt < 60_000) return false;

  const message = `${device.patient_name} ออกนอกพื้นที่ปลอดภัย "${fence.label}"`;

  // Skip repeat alerts while the previous one is still unacknowledged.
  const open = await queryOne(
    env,
    `select id from public.alerts
      where patient_id = $1 and alert_type = 'GEOFENCE_EXIT'
        and acknowledged_at is null and message like $2
      limit 1`,
    [device.patient_id, `${message.slice(0, 250)}%`],
  );
  if (open) return false;

  const alert = await queryOne(
    env,
    `insert into public.alerts (patient_id, device_id, alert_type, severity, message)
     values ($1, $2, 'GEOFENCE_EXIT', 'critical', $3)
     returning id, message, occurred_at`,
    [device.patient_id, device.id, message],
  );

  waitUntil(
    notify(env, device.patient_id, buildAlertEmail, {
      patientName: device.patient_name,
      deviceName: device.device_name,
      message,
      severity: 'critical',
      occurredAt: alert.occurred_at,
    }),
  );

  return true;
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

  if (body.event_type === 'GPS_BATCH') {
    const points = Array.isArray(body.points) ? body.points : null;
    if (!points || points.length === 0 || points.length > 50) {
      throw new HttpError(400, 'points ต้องเป็น array ขนาด 1–50 จุด');
    }

    // Persist every (non-duplicate) point; the client_ref unique constraint
    // absorbs retries from the device's store-and-forward buffer.
    const inserted = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new HttpError(400, `พิกัดจุดที่ ${i + 1} ไม่ถูกต้อง`);
      }
      const recordedAt = new Date(p.recorded_at);
      if (Number.isNaN(recordedAt.getTime())
        || recordedAt.getTime() < Date.now() - 180 * 86400000
        || recordedAt.getTime() > Date.now() + 86400000) {
        throw new HttpError(400, `เวลา recorded_at จุดที่ ${i + 1} อยู่นอกช่วงที่ยอมรับ`);
      }
      const acc = p.acc_m === undefined || p.acc_m === null ? null : Number(p.acc_m);
      const speed = p.speed_kmh === undefined || p.speed_kmh === null ? null : Number(p.speed_kmh);
      const clientRef = typeof p.client_ref === 'string' && p.client_ref.trim() ? p.client_ref.trim().slice(0, 64) : null;
      const row = await queryOne(
        env,
        `insert into public.gps_points
           (patient_id, device_id, lat, lng, acc_m, speed_kmh, recorded_at, client_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (client_ref) do nothing
         returning id, lat, lng, recorded_at`,
        [device.patient_id, device.id, lat, lng, acc, speed, recordedAt.toISOString(), clientRef],
      );
      if (row) inserted.push(row);
    }

    // Hysteresis state machine (margin 15% + 2 points + 60 s), evaluated on
    // freshly ingested points against every active fence of this patient.
    let gateAlerts = 0;
    if (inserted.length) {
      const fences = await query(
        env,
        `select id, label, kind, center_lat, center_lng, radius_m, polygon
           from public.geofences
          where patient_id = $1 and is_active = true
          order by created_at asc`,
        [device.patient_id],
      );

      for (const fence of fences) {
        if (await gateBreach(env, device, fence)) gateAlerts += 1;
      }
    }

    return json(201, {
      ok: true,
      accepted: inserted.length,
      duplicates: points.length - inserted.length,
      geofence_alerts: gateAlerts,
    });
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
