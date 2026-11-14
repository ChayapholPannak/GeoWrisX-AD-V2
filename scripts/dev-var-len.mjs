// Diagnose why CLERK auth failed: read .dev.vars, print only metadata about the secret.
import { readFile } from 'node:fs/promises';
const t = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
let line = t.split(/\r?\n/).find((l) => /^CLERK_SECRET_KEY=/.test(l));
if (!line) { console.log('no CLERK_SECRET_KEY line'); process.exit(1); }
const raw = line.slice('CLERK_SECRET_KEY='.length);
console.log('raw length:', raw.length);
console.log('starts with quote:', /^["']/.test(raw));
console.log('contains spaces:', raw.includes(' '));
const v = raw.replace(/^["']|['"]$/g, '').trim();
console.log('trimmed length:', v.length);
console.log('looks like sk_key:', /^sk_(test|live)_/.test(v));
