import { authenticate } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

/** POST /api/archive-patient */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);
  const patientId = requireUuid(body.patient_id, 'รหัสผู้ป่วยไม่ถูกต้อง');

  if (typeof body.is_archived !== 'boolean') {
    throw new HttpError(400, 'สถานะเก็บเข้าคลังไม่ถูกต้อง');
  }

  const patient = await queryOne(
    env,
    `update public.patients
        set is_archived = $2, updated_at = now()
      where id = $3 and owner_id = $1
      returning id, display_name, is_archived, updated_at`,
    [userId, body.is_archived, patientId],
  );

  if (!patient) {
    throw new HttpError(404, 'ไม่พบผู้ป่วยหรือคุณไม่มีสิทธิ์แก้ไขข้อมูลนี้');
  }

  return json(200, {
    patient,
    message: body.is_archived ? 'เก็บโปรไฟล์ผู้ป่วยเข้าคลังแล้ว' : 'กู้คืนโปรไฟล์ผู้ป่วยแล้ว',
  });
});
