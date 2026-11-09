import { query } from '../_lib/db.js';
import { getClerkUser, secretsMatch } from '../_lib/auth.js';
import { sendEmail } from '../_lib/email.js';
import { HttpError, json, route } from '../_lib/http.js';

/**
 * POST /api/cron/appointment-reminders — internal cron endpoint
 * (protected by x-cron-secret, pinged from workers/med-cron every 15 min).
 *
 * For every scheduled appointment whose occurs_at is within the next 24 h:
 *  · <= 3 h left  → reminder "ล่วงหน้า 3 ชม."
 *  · <= 24 h left → reminder "ล่วงหน้า 1 วัน"
 * Each (appointment × lead) raises ONE info alert (deduped while it stays
 * unacknowledged) and best-effort emails every caregiver of that patient.
 */
export const onRequestPost = route(async ({ request, env }) => {
  if (!(await secretsMatch(request.headers.get('x-cron-secret'), env.CRON_SECRET))) {
    throw new HttpError(401, 'ไม่อนุญาต (cron secret ไม่ถูกต้อง)');
  }

  const upcoming = await query(
    env,
    `select a.id, a.patient_id, a.title, a.place, a.detail, a.occurs_at,
            p.is_archived, p.display_name as patient_name
       from public.patient_appointments a
       join public.patients p on p.id = a.patient_id
      where a.status = 'scheduled'
        and a.occurs_at > now()
        and a.occurs_at <= now() + interval '24 hours'`,
  );

  let created = 0;
  const results = [];

  for (const apt of upcoming) {
    if (apt.is_archived) continue;

    const minutesLeft = (new Date(apt.occurs_at).getTime() - Date.now()) / 60000;
    const lead = minutesLeft <= 180
      ? { bucket: '3h', label: 'ล่วงหน้า 3 ชม.', in_words: 'อีกไม่ถึง 3 ชั่วโมง' }
      : { bucket: '1d', label: 'ล่วงหน้า 1 วัน', in_words: 'อีกไม่เกิน 1 วัน' };

    const whenText = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(apt.occurs_at));

    const message = `เตือนนัดหมาย (${lead.in_words}): พา ${apt.patient_name} ไป "${apt.title}" ที่ ${apt.place} — ${whenText} [นัด ${apt.id.slice(0, 8)} · ${lead.bucket}]`
      .slice(0, 300);

    const open = await query(
      env,
      `select id from public.alerts
        where patient_id = $1 and alert_type = 'OTHER'
          and acknowledged_at is null
          and message like $2
        limit 1`,
      [apt.patient_id, `%นัด ${apt.id.slice(0, 8)} · ${lead.bucket}%`],
    ).catch(() => null);
    if (open && open.length) continue;

    const alert = await query(
      env,
      `insert into public.alerts (patient_id, alert_type, severity, message)
       values ($1, 'OTHER', 'info', $2)
       returning id, occurred_at`,
      [apt.patient_id, message],
    );

    created += 1;
    results.push({ appointment_id: apt.id, lead: lead.bucket, alert_id: alert[0]?.id });

    // Best-effort email to every caregiver of the patient.
    try {
      const members = await query(
        env,
        `select distinct user_id from public.caregiver_links where patient_id = $1`,
        [apt.patient_id],
      );
      for (const m of members) {
        const user = await getClerkUser(m.user_id, env);
        if (!user.email) continue;
        await sendEmail(env, {
          to: user.email,
          subject: `GeoWrisX AD — เตือนนัดหมายของ ${apt.patient_name}`,
          text: message,
          html: `<p>${message}</p>`,
        });
      }
    } catch {
      // Never abort the batch over one failed email.
    }
  }

  return json(200, { ok: true, checked: upcoming.length, created_alerts: created, alerts: results });
});
