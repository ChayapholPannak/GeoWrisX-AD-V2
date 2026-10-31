import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return collect(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

const files = collect('functions');
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`ok   ${file}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${file}`);
    console.error(error.stderr?.toString() || error.message);
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed the syntax check.`);
  process.exit(1);
}

console.log(`\n${files.length} Pages Function file(s) parsed successfully.`);
