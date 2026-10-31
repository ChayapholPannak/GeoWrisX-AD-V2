import { authenticate } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { HttpError, requireUuid, route } from './_lib/http.js';

function contentDisposition(fileName) {
  const ascii = String(fileName || 'download')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName || 'download')}`;
}

/** GET /api/file-download?file_id=<uuid> — streams the R2 object to its owner. */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const fileId = requireUuid(
    new URL(request.url).searchParams.get('file_id'),
    'รหัสไฟล์ไม่ถูกต้อง',
  );

  const file = await queryOne(
    env,
    `select f.id, f.object_key, f.file_name, f.content_type, f.size_bytes::int as size_bytes
       from public.patient_files f
       join public.patients p on p.id = f.patient_id
      where f.id = $1 and p.owner_id = $2
      limit 1`,
    [fileId, userId],
  );
  if (!file) throw new HttpError(404, 'ไม่พบไฟล์หรือคุณไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้');
  if (!env.FILES) throw new HttpError(500, 'เซิร์ฟเวอร์ยังไม่ได้ผูก R2 bucket ชื่อ FILES');

  const object = await env.FILES.get(file.object_key);
  if (!object) throw new HttpError(404, 'ไม่พบไฟล์ในพื้นที่จัดเก็บ อาจถูกลบไปแล้ว');

  const size = Number(object.size ?? file.size_bytes);
  const headers = {
    'Content-Type': file.content_type || 'application/octet-stream',
    'Content-Disposition': contentDisposition(file.file_name),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (Number.isFinite(size) && size > 0) headers['Content-Length'] = String(size);

  return new Response(object.body, { status: 200, headers });
});
