import { authenticate } from './_lib/auth.js';
import { query, queryOne } from './_lib/db.js';
import { json, readJson, route } from './_lib/http.js';
import { parsePatientFields } from './_lib/validate.js';

/** POST /api/create-patient */
export const onRequestPost = route(async ({ request, env }) => {
  const { userId } = await authenticate(request, env);
  const body = await readJson(request);
  const { displayName, relationship, dateOfBirth } = parsePatientFields(body);

  const patient = await queryOne(
    env,
    `insert into public.patients (owner_id, display_name, relationship, date_of_birth)
     values ($1, $2, $3, $4::date)
     returning id, display_name, relationship,
               to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth,
               is_archived, created_at, updated_at`,
    [userId, displayName, relationship, dateOfBirth],
  );

  // The creator is the primary caregiver and the first member of the circle.
  await query(
    env,
    `insert into public.caregiver_links (patient_id, user_id, role)
     values ($1, $2, 'primary')
     on conflict (patient_id, user_id) do nothing`,
    [patient.id, userId],
  );

  return json(201, { patient });
});
