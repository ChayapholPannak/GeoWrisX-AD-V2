import { authenticate, getClerkUser } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
import { HttpError, cleanText, json, readJson, route } from './_lib/http.js';

const PROFILE_COLUMNS = `user_id, full_name, phone, relationship_to_patient, created_at, updated_at`;

/** GET /api/caregiver-profile */
export const onRequestGet = route(async ({ request, env }) => {
  const { userId, claims } = await authenticate(request, env);

  const stored = await queryOne(
    env,
    `select ${PROFILE_COLUMNS} from public.caregiver_profiles where user_id = $1 limit 1`,
    [userId],
  );

  const user = await getClerkUser(userId, env);
  const fallbackName = user.fullName || claims.firstName || claims.first_name || '';

  return json(200, {
    profile: stored || {
      user_id: userId,
      full_name: fallbackName,
      phone: '',
      relationship_to_patient: '',
    },
    email: user.email || '',
  });
});

/** PUT /api/caregiver-profile */
export const onRequestPut = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);

  const fullName = cleanText(body.full_name);
  const phone = cleanText(body.phone);
  const relationship = cleanText(body.relationship_to_patient);

  if (fullName.length < 2 || fullName.length > 100) {
    throw new HttpError(400, 'ชื่อผู้ดูแลต้องมีความยาว 2–100 ตัวอักษร');
  }
  if (phone.length > 30) throw new HttpError(400, 'เบอร์โทรศัพท์ยาวเกินไป');
  if (relationship.length > 80) throw new HttpError(400, 'ความสัมพันธ์ต้องไม่เกิน 80 ตัวอักษร');

  const profile = await queryOne(
    env,
    `insert into public.caregiver_profiles
       (user_id, full_name, phone, relationship_to_patient, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (user_id) do update
       set full_name = excluded.full_name,
           phone = excluded.phone,
           relationship_to_patient = excluded.relationship_to_patient,
           updated_at = now()
     returning ${PROFILE_COLUMNS}`,
    [userId, fullName, phone || null, relationship || null],
  );

  const user = await getClerkUser(userId, env);
  return json(200, { profile, email: user.email || '' });
});
