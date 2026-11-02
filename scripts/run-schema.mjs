// Applies db/schema.sql to the Neon database in NEON_DATABASE_URL (or $1 argv).
// Usage: node scripts/run-schema.mjs
// The connection URL is read from the environment and never printed.
import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

const url = process.env.NEON_DATABASE_URL || process.argv[2] || '';
if (!url) {
  console.error('NEON_DATABASE_URL not set');
  process.exit(1);
}

const sqlFile = new URL('../db/schema.sql', import.meta.url);
const sqlText = await readFile(sqlFile, 'utf8');

// Split into individual statements while respecting $$ bodies, comments and
// quoted strings (schema.sql contains CREATE FUNCTION ... $$ ... $$ blocks).
function splitStatements(text) {
  const out = [];
  let start = 0;
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inDollar = false;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') inLine = false;
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inDollar) {
      if (ch === '$' && next === '$') {
        inDollar = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      if (ch === "'") {
        if (next === "'") i += 2;
        else inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === '$' && next === '$') {
      inDollar = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === ';') {
      const stmt = text.slice(start, i + 1);
      if (stmt.replace(/[\s;]+/g, '').length) out.push(stmt);
      start = i + 1;
    }
    i += 1;
  }
  const tail = text.slice(start);
  if (tail.replace(/\s+/g, '').length) out.push(tail);
  return out;
}

const stmts = splitStatements(sqlText);
const sql = neon(url);
for (let n = 0; n < stmts.length; n += 1) {
  const stmt = stmts[n];
  const label = stmt.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().slice(0, 60);
  try {
    await sql.query(stmt);
  } catch (error) {
    console.error(`statement ${n + 1}/${stmts.length} failed: ${label}`);
    console.error(error?.message || error);
    process.exit(1);
  }
}
console.log(`schema applied ok (${stmts.length} statements)`);
