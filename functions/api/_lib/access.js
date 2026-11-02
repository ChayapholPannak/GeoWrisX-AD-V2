import { queryOne } from './db.js';
import { HttpError } from './http.js';

/**
 * Caregiver sharing lives in public.caregiver_links:
 *   'primary'   — full control (mirrors patients.owner_id)
 *   'companion' — shared caregiver: sees data, gets alert emails, may approve
 *                 pillbox requests; cannot edit patient data or files
 */

/**
 * Returns 'primary' | 'companion' | null for this patient/user pair.
 * caregiver_links is authoritative; patients.owner_id is only the fast path
 * for the primary's mutations.
 */
export function membershipOf(env, patientId, userId) {
  return queryOne(
    env,
    'select role from public.caregiver_links where patient_id = $1 and user_id = $2 limit 1',
    [patientId, userId],
  ).then((row) => (row ? row.role : null));
}

/** Throws 404 unless the user is a member (any role) of this patient. */
export async function assertMember(env, patientId, userId) {
  const role = await membershipOf(env, patientId, userId);
  if (!role) {
    throw new HttpError(404, 'ไม่พบผู้ป่วยหรือคุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
  }
  return role;
}

/** Throws 404 when the user is not the primary caregiver of this patient. */
export async function assertPrimary(env, patientId, userId) {
  const role = await membershipOf(env, patientId, userId);
  if (role !== 'primary') {
    throw new HttpError(404, 'ไม่พบผู้ป่วยหรือเฉพาะเจ้าของหลักเท่านั้นที่ทำรายการนี้ได้');
  }
  return role;
}
