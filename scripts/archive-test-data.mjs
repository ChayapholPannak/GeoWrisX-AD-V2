// One-off: park the production test dataset ("ทดสอบ สายรัด") so a real
// deployment starts clean. Everything is archived (recoverable), not deleted:
// rerun with --restore to bring it back after a demo.
const mode = process.argv.includes('--restore') ? 'restore' : 'archive';

const envFile = (await import('node:fs')).readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const lines = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const url = (process.env.NEON_DATABASE_URL || lines.NEON_DATABASE_URL).replace(/^"(.*)"$/, '$1');
const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);

const result = await sql`
  with parked as (
    update public.patients
       set is_archived = ${mode === 'archive'}
     where display_name = 'ทดสอบ สายรัด'
    returning id
  )
  select (select count(*) from parked) as affected`;

console.log(`${mode}: ${result[0].affected} patient row(s) updated`);
