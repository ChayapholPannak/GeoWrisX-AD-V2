import { authenticate } from './_lib/auth.js';
import { queryOne } from './_lib/db.js';
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

  return json(201, { patient });
});
