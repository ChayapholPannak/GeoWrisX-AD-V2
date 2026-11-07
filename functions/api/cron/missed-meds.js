import { query, queryOne } from '../_lib/db.js';
import { getClerkUser, secretsMatch } from '../_lib/auth.js';
import { buildAlertEmail, sendEmail } from '../_lib/email.js';
import { HttpError, json, route } from '../_lib/http.js';

/** Cold the wall-clock helpers: all schedule math runs in Asia/Bangkok (+7, no DST). */

function bangkokNow() {
  const shifted = new Date(Date.now() + 7 * 3600_000);
  return {
    shiftMs: 7 * 3600_000,
    dayOfWeek: shifted.getUTCDay(), // 0 = Sunday, same convention as med_schedules.days
    minuteOfDay: shifted.getUTCMinutes() + shifted.getUTCHours() * 60,
    midnightBkk: Math.floor((Date.now() + 7 * 3600_000) / 86400000) * 86400000 - 7 * 3600_000,
  };
}

/**
 * POST /api/missed-meds — internal cron endpoint (protected by x-cron-secret).
 * For every active schedule whose slot passed >= 60 min ago (and < 12 h) today:
 * if no med_intake ties to that schedule since the Bangkok midnight, raise a
 * PILL_NOT_TAKEN alert — deduped while the previous one stays unacknowledged.
 */
export const onRequestPost = route(async ({ request, env }) => {
  if (!(await secretsMatch(request.headers.get('x-cron-secret'), env.CRON_SECRET))) {
    throw new HttpError(401, 'ไม่อนุญาต (cron secret ไม่ถูกต้อง)');
  }

  const now = bangkokNow();
  const todayIso = new Date(Date.now() + now.shiftMs).toISOString().slice(0, 10);

  // Only schedules whose device has an unarchived patient.
  const schedules = await query(
    env,
    `select s.id, s.patient_id, s.label, s.time_of_day, s.compart_no, s.days,
            p.is_archived, p.display_name as patient_name
       from public.med_schedules s
       join public.patients p on p.id = s.patient_id
      where s.is_active = true`,
  );

  let created = 0;
  const results = [];

  for (const s of schedules) {
    if (s.is_archived) continue;
    if (!Array.isArray(s.days) || !s.days.includes(now.dayOfWeek)) continue;

    const [hh, mm] = String(s.time_of_day).split(':').map(Number);
    const slot = hh * 60 + mm;
    const lateMinutes = now.minuteOfDay - slot;
    // Warn from 60 min late up to 12 h (so a long outage does not stack alerts).
    if (lateMinutes < 60 || lateMinutes > 12 * 60) continue;

    const takenToday = await queryOne(
      env,
      `select id from public.med_intakes
        where schedule_id = $1 and taken_at >= $2
        limit 1`,
      [s.id, new Date(now.midnightBkk).toISOString()],
    );
    if (takenToday) continue;

    const message = `${s.patient_name} ยังไม่ได้ทานยา "${s.label}" ตามเวลา ${String(s.time_of_day).slice(0, 5)} (ช่องที่ ${s.compart_no})`;

    const open = await queryOne(
      env,
      `select id from public.alerts
        where patient_id = $1 and alert_type = 'PILL_NOT_TAKEN'
          and acknowledged_at is null and message like $2
        limit 1`,
      [s.patient_id, `${message.slice(0, 250)}%`],
    );
    if (open) continue;

    const alert = await queryOne(
      env,
      `insert into public.alerts (patient_id, alert_type, severity, message)
       values ($1, 'PILL_NOT_TAKEN', 'warning', $2)
       returning id, occurred_at`,
      [s.patient_id, message],
    );

    created += 1;
    results.push({ schedule_id: s.id, label: s.label, alert_id: alert.id });

    // Best-effort email to every caregiver of the patient.
    try {
      if (env.ALERT_NOTIFY_TO) {
        await sendEmail(env, { to: env.ALERT_NOTIFY_TO, ...buildAlertEmail({
          patientName: s.patient_name,
          deviceName: 'กล่องยา',
          message,
          severity: 'warning',
          occurredAt: alert.occurred_at,
        }) });
      } else {
        const members = await query(env, `select distinct user_id from public.caregiver_links where patient_id = $1`, [s.patient_id]);
        const tos = [];
        for (const m of members) {
          const user = await getClerkUser(m.user_id, env);
          if (user.email && !tos.includes(user.email)) tos.push(user.email);
        }
        for (const to of tos) {
          await sendEmail(env, { to, ...buildAlertEmail({
            patientName: s.patient_name,
            deviceName: 'กล่องยา',
            message,
            severity: 'warning',
            occurredAt: alert.occurred_at,
          }) });
        }
      }
    } catch {
      // Never abort the batch over one failed email.
    }
  }

  return json(200, {
    ok: true,
    checked: schedules.length,
    date_bkk: todayIso,
    created_alerts: created,
    alerts: results,
  });
});
