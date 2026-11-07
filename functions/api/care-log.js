import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { assertMember } from './_lib/access.js';
import { HttpError, json, requireUuid, route } from './_lib/http.js';

/**
 * GET /api/care-log?patient_id=...&days=7
 * Everything the care-log view renders: sleep nights, heart-rate samples,
 * medication schedule + intakes, plus daily rollups for the summary cards.
 */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const patientId = requireUuid(url.searchParams.get('patient_id'), 'ต้องระบุ patient_id ให้ถูกต้อง');
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 30);
  await assertMember(env, patientId, userId);

  const [patient, sleep, hr, schedules, intakes] = await Promise.all([
    queryOne(env, `select id, display_name, is_archived from public.patients where id = $1 limit 1`, [patientId]),
    query(
      env,
      `select id, night_date, asleep_at, woke_at, duration_min, restless_min, awake_min, quality
         from public.sleep_nights
        where patient_id = $1 and night_date >= (current_date - ($2::int - 1))
        order by night_date desc, asleep_at desc
        limit 40`,
      [patientId, days],
    ),
    query(
      env,
      `select bpm, spo2, recorded_at
         from public.hr_samples
        where patient_id = $1 and recorded_at >= now() - ($2::text || ' hours')::interval
        order by recorded_at desc
        limit 200`,
      [patientId, String(Math.max(days * 24, 24))],
    ),
    query(
      env,
      `select id, label, time_of_day, compart_no, days, is_active
         from public.med_schedules
        where patient_id = $1
        order by is_active desc, time_of_day`,
      [patientId],
    ),
    query(
      env,
      `select mi.id, mi.schedule_id, mi.compart_no, mi.action, mi.weight_g, mi.taken_at,
              s.label as schedule_label
         from public.med_intakes mi
         left join public.med_schedules s on s.id = mi.schedule_id
        where mi.patient_id = $1 and mi.taken_at >= now() - ($2::text || ' days')::interval
        order by mi.taken_at desc
        limit 120`,
      [patientId, days],
    ),
  ]);

  if (!patient) throw new HttpError(404, 'ไม่พบผู้ป่วย');

  // Rollups for the header cards.
  const sleepAvgMin = sleep.length
    ? Math.round(sleep.reduce((acc, n) => acc + n.duration_min, 0) / sleep.length)
    : null;
  const hrValues = hr.map((h) => h.bpm);
  const hrAvg = hrValues.length ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null;
  const hrMin = hrValues.length ? Math.min(...hrValues) : null;
  const hrMax = hrValues.length ? Math.max(...hrValues) : null;
  const pillboxEvents = intakes.filter((i) => i.action === 'taken').length;
  const missedDays = intakes.filter((i) => i.action === 'missed').length;

  return json(200, {
    patient: { id: patient.id, display_name: patient.display_name, is_archived: patient.is_archived },
    window_days: days,
    sleep,
    hr: hr.slice(0, 120).reverse(), // oldest -> newest for the chart
    schedules,
    intakes,
    summary: {
      sleep_avg_min: sleepAvgMin,
      sleep_nights: sleep.length,
      hr_avg: hrAvg,
      hr_min: hrMin,
      hr_max: hrMax,
      hr_count: hr.length,
      pillbox_events: pillboxEvents,
      missed_events: missedDays,
    },
  });
});
