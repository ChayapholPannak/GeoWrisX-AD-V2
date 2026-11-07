import { getClerkUser, secretsMatch } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { buildAlertEmail, buildPillboxRequestEmail, sendEmail } from './_lib/email.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';
import { enforceRateLimit } from './_lib/ratelimit.js';
import { circularGateState, haversineM, pointInPolygon } from './_lib/geo.js';

const ALLOWED_EVENTS = new Set([
  'GEOFENCE_EXIT',
  'TAMPER',
  'LOW_BATTERY',
  'BLE_DISCONNECTED',
  'DEVICE_STATUS',
  'PILLBOX_REQUEST',
  'GPS_BATCH',
  'SLEEP_SUMMARY',
  'HR_BATCH',
  'MED_EVENT',
]);

/** Valid time-of-day string "HH:MM" (24 h). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates an ISO timestamp inside the 90-days-back / 1-day-forward window. */
function parseRecentIso(value, field) {
  const at = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(at.getTime())
    || at.getTime() < Date.now() - 90 * 86400000
    || at.getTime() > Date.now() + 86400000) {
    throw new HttpError(400, `${field} อยู่นอกช่วงที่ยอมรับ`);
  }
  return at.toISOString();
}

function parseClientRef(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : null;
}

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
async function gateBreach(env, device, fence, waitUntil) {
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
        if (await gateBreach(env, device, fence, waitUntil)) gateAlerts += 1;
      }
    }

    return json(201, {
      ok: true,
      accepted: inserted.length,
      duplicates: points.length - inserted.length,
      geofence_alerts: gateAlerts,
    });
  }

  if (body.event_type === 'SLEEP_SUMMARY') {
    // One night per device per date; retries upsert through client_ref.
    const nightDate = typeof body.night_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.night_date)
      ? body.night_date
      : null;
    if (!nightDate) throw new HttpError(400, 'night_date ต้องเป็นรูปแบบ YYYY-MM-DD');

    const asleepAt = new Date(parseRecentIso(body.asleep_at, 'asleep_at'));
    const wokeAt = new Date(parseRecentIso(body.woke_at, 'woke_at'));
    const durationMin = Math.round((wokeAt - asleepAt) / 60000);
    if (asleepAt.getTime() >= wokeAt.getTime() || durationMin > 1440) {
      throw new HttpError(400, 'ช่วงเวลานอนไม่ถูกต้อง (ห้ามย้อนหรือเกิน 24 ชม.)');
    }
    const restlessMin = Number(body.restless_min ?? 0);
    const awakeMin = Number(body.awake_min ?? 0);
    if (!Number.isFinite(restlessMin) || restlessMin < 0 || restlessMin > durationMin
      || !Number.isFinite(awakeMin) || awakeMin < 0 || awakeMin > durationMin) {
      throw new HttpError(400, 'restless_min/awake_min ไม่ถูกต้อง');
    }
    const quality = ['good', 'fair', 'poor', 'unknown'].includes(body.quality)
      ? body.quality
      : 'unknown';

    const night = await queryOne(
      env,
      `insert into public.sleep_nights
         (patient_id, device_id, night_date, asleep_at, woke_at, duration_min,
          restless_min, awake_min, quality, client_ref)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (client_ref) do nothing
       returning id, night_date, duration_min, quality`,
      [device.patient_id, device.id, nightDate, asleepAt.toISOString(), wokeAt.toISOString(),
       durationMin, Math.round(restlessMin), Math.round(awakeMin), quality, parseClientRef(body.client_ref)],
    );

    return json(201, { ok: true, accepted: night ? 1 : 0, duplicates: night ? 0 : 1, night });
  }

  if (body.event_type === 'HR_BATCH') {
    const samples = Array.isArray(body.samples) ? body.samples : null;
    if (!samples || samples.length === 0 || samples.length > 50) {
      throw new HttpError(400, 'samples ต้องเป็น array ขนาด 1–50 จุด');
    }

    const inserted = [];
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      const bpm = Number(s.bpm);
      if (!Number.isInteger(bpm) || bpm < 30 || bpm > 200) {
        throw new HttpError(400, `bpm จุดที่ ${i + 1} ต้องอยู่ระหว่าง 30–200`);
      }
      const spo2 = s.spo2 === undefined || s.spo2 === null ? null : Number(s.spo2);
      if (spo2 !== null && (!Number.isInteger(spo2) || spo2 < 50 || spo2 > 100)) {
        throw new HttpError(400, `spo2 จุดที่ ${i + 1} ต้องอยู่ระหว่าง 50–100`);
      }
      const row = await queryOne(
        env,
        `insert into public.hr_samples (patient_id, device_id, bpm, spo2, recorded_at, client_ref)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (client_ref) do nothing
         returning id, bpm, recorded_at`,
        [device.patient_id, device.id, bpm, spo2, parseRecentIso(s.recorded_at, `recorded_at จุดที่ ${i + 1}`), parseClientRef(s.client_ref)],
      );
      if (row) inserted.push(row);
    }

    return json(201, { ok: true, accepted: inserted.length, duplicates: samples.length - inserted.length });
  }

  if (body.event_type === 'MED_EVENT') {
    const compartment = Number(body.compartment_no);
    if (!Number.isInteger(compartment) || compartment < 1 || compartment > 3) {
      throw new HttpError(400, 'compartment_no ต้องอยู่ระหว่าง 1–3');
    }
    const action = ['taken', 'missed', 'unscheduled'].includes(body.action) ? body.action : null;
    if (!action) throw new HttpError(400, 'action ต้องเป็น taken / missed / unscheduled');
    const takenAt = parseRecentIso(body.taken_at, 'taken_at');
    const weightG = body.weight_g === undefined || body.weight_g === null
      ? null
      : Math.round(Number(body.weight_g) * 10) / 10;

    // Attach the matching schedule when the device names one, or auto-match the
    // intake against a ±45-minute window of an active schedule (Bangkok time).
    let scheduleId = null;
    const takenMs = new Date(takenAt).getTime() + 7 * 3600_000; // shift to Asia/Bangkok wall clock
    const takenMinutes = Math.floor((takenMs % 86400000) / 60000);

    if (typeof body.schedule_id === 'string' && body.schedule_id.length === 36) {
      const match = await queryOne(
        env,
        `select id from public.med_schedules
          where id = $1 and patient_id = $2 and is_active = true
          limit 1`,
        [body.schedule_id, device.patient_id],
      );
      if (match) scheduleId = match.id;
    }
    if (!scheduleId) {
      const schedules = await query(
        env,
        `select id, time_of_day
           from public.med_schedules
          where patient_id = $1 and is_active = true`,
        [device.patient_id],
      );
      for (const s of schedules) {
        const [hh, mm] = String(s.time_of_day).split(':').map(Number);
        const schedMinutes = hh * 60 + mm;
        if (Math.abs(takenMinutes - schedMinutes) <= 45) {
          scheduleId = s.id;
          break;
        }
      }
    }

    const intake = await queryOne(
      env,
      `insert into public.med_intakes
         (patient_id, pillbox_id, schedule_id, compart_no, action, weight_g, taken_at, client_ref)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (client_ref) do nothing
       returning id, action, taken_at`,
      [device.patient_id, device.id, scheduleId, compartment, action, weightG, takenAt, parseClientRef(body.client_ref)],
    );

    // Device-reported missed doses raise the same alert the cron raises.
    let alert = null;
    if (intake && action === 'missed') {
      alert = await queryOne(
        env,
        `insert into public.alerts (patient_id, device_id, alert_type, severity, message)
         values ($1, $2, 'PILL_NOT_TAKEN', 'warning', $3)
         returning id, message, occurred_at`,
        [device.patient_id, device.id,
         typeof body.message === 'string' && body.message.trim()
           ? body.message.trim().slice(0, 300)
           : `${device.patient_name} ไม่ได้ทานยา (ช่องที่ ${compartment})`],
      );
    }

    return json(201, { ok: true, accepted: intake ? 1 : 0, duplicates: intake ? 0 : 1, alert });
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
