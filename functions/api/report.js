import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { assertMember } from './_lib/access.js';
import { HttpError, requireUuid, route } from './_lib/http.js';

/**
 * GET /api/report?patient_id=...&days=7&kind=summary|events
 *
 * CSV exports used for the weekly/monthly caregiver report (R&D / OCOP docs).
 *   kind=summary — one row per day: sleep minutes, HR avg/min/max, meds taken/missed
 *   kind=events  — raw event rows grouped by section (sleep nights, HR samples,
 *                  medication intakes, alerts)
 *
 * Guards: any caregiver linked to the patient may download (assertMember),
 * not only the primary owner — reports are read-only.
 */

const TZ = 'Asia/Bangkok';

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r?\n/g, ' ').trim();
  if (/[",;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Date-only (night_date etc.) or timestamp -> YYYY-MM-DD in the device timezone. */
function fmtDate(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Timestamp -> 'YYYY-MM-DD HH:mm' in the device timezone (readable in Excel). */
function fmtTs(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function csvResponse(rows, asciiName, utf8Name) {
  const bom = '\uFEFF'; // so Excel / Google Sheets read Thai correctly
  const body = bom + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function dayList(days) {
  // Oldest -> newest, date-only strings in the device timezone.
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10)); // UTC date matches generate_series(current_date)
  }
  return out;
}

function buildSummaryRows(sleepRows, hrRows, medRows, days) {
  const sleepByDate = new Map(sleepRows.map((r) => [String(r.day).slice(0, 10), r]));
  const hrByDate = new Map(hrRows.map((r) => [String(r.day).slice(0, 10), r]));
  const medByDate = new Map(medRows.map((r) => [String(r.day).slice(0, 10), r]));

  const header = ['date', 'sleep_min', 'sleep_nights', 'hr_avg', 'hr_min', 'hr_max', 'meds_taken', 'meds_missed'];
  const rows = [header];
  for (const day of dayList(days)) {
    const s = sleepByDate.get(day);
    const h = hrByDate.get(day);
    const m = medByDate.get(day);
    rows.push([
      day,
      s ? s.sleep_avg : '',
      s ? s.nights : '',
      h ? h.hr_avg : '',
      h ? h.hr_min : '',
      h ? h.hr_max : '',
      m ? m.taken : '',
      m ? m.missed : '',
    ]);
  }
  return rows;
}

function buildEventSections(sleep, hr, intakes, alerts) {
  const rows = [];
  rows.push(['section', 'at', 'a', 'b', 'c', 'd']);

  rows.push(['sleep', 'night_date/asleep/woke', 'duration_min', 'restless_min', 'awake_min', 'quality']);
  for (const n of sleep) {
    rows.push(['sleep', fmtDate(n.night_date), fmtTs(n.asleep_at), fmtTs(n.woke_at), n.duration_min, `${n.restless_min}/${n.awake_min}`, n.quality || '']);
  }
  rows.push(['']);

  rows.push(['hr', 'recorded_at', 'bpm', 'spo2', '', '']);
  for (const h of hr) {
    rows.push(['hr', fmtTs(h.recorded_at), h.bpm, h.spo2 ?? '', '', '']);
  }
  rows.push(['']);

  rows.push(['meds', 'taken_at', 'action', 'schedule', 'compart_no', 'weight_g']);
  for (const i of intakes) {
    rows.push(['meds', fmtTs(i.taken_at), i.action, i.schedule_label || `ช่องที่ ${i.compart_no}`, i.compart_no, i.weight_g ?? '']);
  }
  rows.push(['']);

  rows.push(['alerts', 'occurred_at', 'alert_type', 'severity', 'message', 'acknowledged_at']);
  for (const a of alerts) {
    rows.push(['alerts', fmtTs(a.occurred_at), a.alert_type, a.severity || '', a.message || '', a.acknowledged_at ? fmtTs(a.acknowledged_at) : '']);
  }
  return rows;
}

export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const url = new URL(request.url);
  const patientId = requireUuid(url.searchParams.get('patient_id'), 'ต้องระบุ patient_id ให้ถูกต้อง');
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 90);
  const kind = ['summary', 'events'].includes(url.searchParams.get('kind'))
    ? url.searchParams.get('kind')
    : 'summary';
  await assertMember(env, patientId, userId);

  const patient = await queryOne(env, `select display_name from public.patients where id = $1 limit 1`, [patientId]);
  if (!patient) throw new HttpError(404, 'ไม่พบผู้ป่วย');

  const safeName = String(days) + 'd-' + kind;

  if (kind === 'summary') {
    const [sleepRows, hrRows, medRows] = await Promise.all([
      query(
        env,
        `select night_date::text as day, round(avg(duration_min))::int as sleep_avg, count(*)::int as nights
           from public.sleep_nights
          where patient_id = $1 and night_date >= (current_date - ($2::int - 1))
          group by night_date order by night_date`,
        [patientId, days],
      ),
      query(
        env,
        `select (recorded_at at time zone '${TZ}')::date::text as day,
                round(avg(bpm))::int as hr_avg, min(bpm)::int as hr_min, max(bpm)::int as hr_max
           from public.hr_samples
          where patient_id = $1 and recorded_at >= now() - ($2::text || ' days')::interval
          group by 1 order by 1`,
        [patientId, days],
      ),
      query(
        env,
        `select (taken_at at time zone '${TZ}')::date::text as day,
                count(*) filter (where action = 'taken')::int as taken,
                count(*) filter (where action in ('missed','unscheduled'))::int as missed
           from public.med_intakes
          where patient_id = $1 and taken_at >= now() - ($2::text || ' days')::interval
          group by 1 order by 1`,
        [patientId, days],
      ),
    ]);
    const rows = buildSummaryRows(sleepRows, hrRows, medRows, days);
    return csvResponse(
      rows,
      `geowrisx-report-${safeName}.csv`,
      `รายงานสรุปรายวัน-${patient.display_name}-${days}วัน.csv`,
    );
  }

  // kind === 'events' — raw rows per section
  const [sleep, hr, intakes, alerts] = await Promise.all([
    query(
      env,
      `select night_date, asleep_at, woke_at, duration_min, restless_min, awake_min, quality
         from public.sleep_nights
        where patient_id = $1 and night_date >= (current_date - ($2::int - 1))
        order by night_date desc limit 92`,
      [patientId, days],
    ),
    query(
      env,
      `select recorded_at, bpm, spo2
         from public.hr_samples
        where patient_id = $1 and recorded_at >= now() - ($2::text || ' days')::interval
        order by recorded_at desc limit 600`,
      [patientId, days],
    ),
    query(
      env,
      `select mi.taken_at, mi.action, mi.compart_no, mi.weight_g,
              s.label as schedule_label
         from public.med_intakes mi
         left join public.med_schedules s on s.id = mi.schedule_id
        where mi.patient_id = $1 and mi.taken_at >= now() - ($2::text || ' days')::interval
        order by mi.taken_at desc limit 300`,
      [patientId, days],
    ),
    query(
      env,
      `select alert_type, severity, message, occurred_at, acknowledged_at
         from public.alerts
        where patient_id = $1 and occurred_at >= now() - ($2::text || ' days')::interval
        order by occurred_at desc limit 300`,
      [patientId, days],
    ),
  ]);

  const rows = buildEventSections(sleep, hr, intakes, alerts);
  return csvResponse(
    rows,
    `geowrisx-events-${safeName}.csv`,
    `รายงานเหตุการณ์-${patient.display_name}-${days}วัน.csv`,
  );
});
