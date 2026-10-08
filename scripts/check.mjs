import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function check(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (file.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', file], {encoding:'utf8'});
      if (result.status) throw new Error(result.stderr);
    }
  }
}
for (const folder of ['public','lib','netlify/functions','scripts','tests']) await check(path.join(root,folder));
await readFile(path.join(root,'public/index.html'));
const tests = spawnSync(process.execPath,['--test', ...((await readdir(path.join(root,'tests'))).filter(f => f.endsWith('.test.mjs')).map(f => path.join(root,'tests',f)))],{stdio:'inherit'});
if (tests.status) process.exit(tests.status);
console.log('JavaScript og vejrvurdering valideret. public/ er klar til Netlify.');
