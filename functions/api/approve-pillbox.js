import { authenticate } from './_lib/auth.js';
import { query } from './_lib/db.js';
import { HttpError, json, readJson, requireUuid, route } from './_lib/http.js';

/**
 * POST /api/approve-pillbox
 *
 * The Postgres function validates ownership, pending state, expiry and the BLE
 * proof, then approves and queues a short-lived command in one transaction.
 */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);
  const requestId = requireUuid(body.request_id, 'รหัสคำขอไม่ถูกต้อง');

  let rows;
  try {
    rows = await query(
      env,
      'select public.approve_pillbox_request($1::uuid, $2::text) as result',
      [requestId, userId],
    );
  } catch (error) {
    const message = String(error?.message || '');

    if (message.includes('BLE_NOT_VERIFIED')) {
      throw new HttpError(409, 'ยังไม่ได้รับการยืนยันระยะใกล้ผ่าน BLE จากกล่องยา');
    }
    if (message.includes('REQUEST_EXPIRED')) {
      throw new HttpError(409, 'คำขอนี้หมดอายุแล้ว กรุณาให้กล่องยาส่งคำขอใหม่');
    }
    if (message.includes('REQUEST_NOT_PENDING')) {
      throw new HttpError(409, 'คำขอนี้ถูกดำเนินการไปแล้ว');
    }
    if (message.includes('REQUEST_NOT_FOUND')) {
      throw new HttpError(404, 'ไม่พบคำขอหรือคุณไม่มีสิทธิ์อนุมัติคำขอนี้');
    }

    console.error('approve-pillbox database error:', message);
    throw new HttpError(500, 'อนุมัติไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าฐานข้อมูล');
  }

  return json(200, {
    result: rows[0]?.result || null,
    message: 'อนุมัติแล้วและเพิ่มคำสั่งลงคิวอุปกรณ์แล้ว',
  });
});
