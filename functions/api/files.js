import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { HttpError, json, requireUuid, route } from './_lib/http.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function bucket(env) {
  if (!env.FILES) {
    throw new HttpError(500, 'เซิร์ฟเวอร์ยังไม่ได้ผูก R2 bucket ชื่อ FILES');
  }
  return env.FILES;
}

function sanitizeFileName(name) {
  const base = String(name || 'ไฟล์แนบ').split(/[\\/]/).pop() || 'ไฟล์แนบ';
  return base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["\\]/g, '_')
    .trim()
    .slice(0, 160) || 'ไฟล์แนบ';
}

async function assertPatientOwnership(env, patientId, userId) {
  const patient = await queryOne(
    env,
    'select id, display_name from public.patients where id = $1 and owner_id = $2 limit 1',
    [patientId, userId],
  );
  if (!patient) throw new HttpError(404, 'ไม่พบผู้ป่วยหรือคุณไม่มีสิทธิ์เข้าถึงไฟล์นี้');
  return patient;
}

/** GET /api/files?patient_id=<uuid> */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const patientId = requireUuid(
    new URL(request.url).searchParams.get('patient_id'),
    'รหัสผู้ป่วยไม่ถูกต้อง',
  );

  await assertPatientOwnership(env, patientId, userId);

  const files = await query(
    env,
    `select id, patient_id, file_name, content_type,
            size_bytes::int as size_bytes, created_at
       from public.patient_files
      where patient_id = $1
      order by created_at desc
      limit 200`,
    [patientId],
  );

  return json(200, { files });
});

/** POST /api/files  (multipart/form-data: patient_id + file) */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new HttpError(413, 'ไฟล์มีขนาดใหญ่เกิน 25 MB');
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง (ต้องเป็น multipart/form-data)');
  }

  const patientId = requireUuid(String(form.get('patient_id') || ''), 'รหัสผู้ป่วยไม่ถูกต้อง');
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.stream !== 'function') {
    throw new HttpError(400, 'กรุณาเลือกไฟล์ที่ต้องการอัปโหลด');
  }
  if (file.size <= 0) throw new HttpError(400, 'ไฟล์ว่างเปล่า');
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'ไฟล์มีขนาดใหญ่เกิน 25 MB');

  await assertPatientOwnership(env, patientId, userId);

  const fileName = sanitizeFileName(file.name);
  const contentType = String(file.type || 'application/octet-stream').slice(0, 120);
  const objectKey = `patient-files/${patientId}/${crypto.randomUUID()}`;
  const storage = bucket(env);

  await storage.put(objectKey, file, {
    httpMetadata: { contentType },
    customMetadata: {
      ownerId: userId,
      patientId,
      originalName: encodeURIComponent(fileName),
    },
  });

  try {
    const created = await queryOne(
      env,
      `insert into public.patient_files
         (patient_id, object_key, file_name, content_type, size_bytes)
       values ($1, $2, $3, $4, $5)
       returning id, patient_id, file_name, content_type,
                 size_bytes::int as size_bytes, created_at`,
      [patientId, objectKey, fileName, contentType, file.size],
    );
    return json(201, { file: created });
  } catch (error) {
    // Do not leave an orphaned object when the metadata write fails.
    await storage.delete(objectKey).catch(() => {});
    throw error;
  }
});

/** DELETE /api/files?file_id=<uuid> */
export const onRequestDelete = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const fileId = requireUuid(
    new URL(request.url).searchParams.get('file_id'),
    'รหัสไฟล์ไม่ถูกต้อง',
  );

  const file = await queryOne(
    env,
    `select f.id, f.object_key
       from public.patient_files f
       join public.patients p on p.id = f.patient_id
      where f.id = $1 and p.owner_id = $2
      limit 1`,
    [fileId, userId],
  );
  if (!file) throw new HttpError(404, 'ไม่พบไฟล์หรือคุณไม่มีสิทธิ์ลบไฟล์นี้');

  await bucket(env).delete(file.object_key);
  await query(env, 'delete from public.patient_files where id = $1', [fileId]);

  return json(200, { ok: true, deleted: fileId });
});
