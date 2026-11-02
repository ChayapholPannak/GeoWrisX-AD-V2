// Verifies the multi-caregiver schema objects are present on the target DB.
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL);
const tables = await sql.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('caregiver_links', 'caregiver_invites')`,
);
const links = await sql.query(
  'select count(*)::int as n, role from public.caregiver_links group by role',
);
const fn = await sql.query(
  `select proname from pg_proc where proname = 'approve_pillbox_request'`,
);
const indexes = await sql.query(
  `select indexname from pg_indexes
    where tablename = 'caregiver_invites' and indexname = 'caregiver_invites_pending_uniq'`,
);
console.log(JSON.stringify({ tables, links, fn, indexes }));
