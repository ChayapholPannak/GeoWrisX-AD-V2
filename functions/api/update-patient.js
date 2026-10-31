import { authenticate } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';
import { parsePatientFields } from './_lib/validate.js';

/** PATCH /api/update-patient */
export const onRequestPatch = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);
  const patientId = requireUuid(body.patient_id, 'รหัสผู้ป่วยไม่ถูกต้อง');
  const { displayName, relationship, dateOfBirth } = parsePatientFields(body);

  const patient = await queryOne(
    env,
    `update public.patients
        set display_name = $2,
            relationship = $3,
            date_of_birth = $4::date,
            updated_at = now()
      where id = $5 and owner_id = $1
      returning id, display_name, relationship,
                to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth,
                is_archived, created_at, updated_at`,
    [userId, displayName, relationship, dateOfBirth, patientId],
  );

  if (!patient) {
    throw new HttpError(404, 'ไม่พบผู้ป่วยหรือคุณไม่มีสิทธิ์แก้ไขข้อมูลนี้');
  }

  return json(200, { patient });
});
