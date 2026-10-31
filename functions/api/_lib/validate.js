import { HttpError, cleanText } from './http.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validate the editable patient fields shared by create-patient and update-patient. */
export function parsePatientFields(body) {
  const displayName = cleanText(body.display_name);
  const relationship = cleanText(body.relationship);
  const dateOfBirth = cleanText(body.date_of_birth);

  if (displayName.length < 2 || displayName.length > 100) {
    throw new HttpError(400, 'ชื่อผู้ป่วย/รหัสนามแฝงต้องมีความยาว 2–100 ตัวอักษร');
  }
  if (relationship.length > 80) {
    throw new HttpError(400, 'ความสัมพันธ์ต้องไม่เกิน 80 ตัวอักษร');
  }
  if (dateOfBirth) {
    if (!isValidDate(dateOfBirth)) throw new HttpError(400, 'วันเกิดไม่ถูกต้อง');
    const today = new Date().toISOString().slice(0, 10);
    if (dateOfBirth > today) throw new HttpError(400, 'วันเกิดต้องไม่เป็นวันที่ในอนาคต');
  }

  return {
    displayName,
    relationship: relationship || null,
    dateOfBirth: dateOfBirth || null,
  };
}
