#!/usr/bin/env node
// Fast gate for a single fix: checks only the side(s) touched by the working-tree change.
// Usage: node scripts/verify-changed.mjs [--files a,b,...] [--base <ref>] [--all]
//   --files limits the check to the given repo-relative paths (use it while the tree holds unrelated edits).
//   backend touched  -> tsc --noEmit + jest --findRelatedTests <changed backend files>
//   frontend touched -> svelte-kit sync + svelte-check
// Full release gates stay in tests/run-quality.cjs (npm run check / test / build).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = baseIndex >= 0 ? args[baseIndex + 1] : 'HEAD';
const all = args.includes('--all');
const filesIndex = args.indexOf('--files');
const explicit = filesIndex >= 0 ? args[filesIndex + 1].split(',').map((f) => f.trim()).filter(Boolean) : null;

function git(...gitArgs) {
  const r = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${r.stderr}`);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

const changed = all
  ? ['backend/src/main.ts', 'frontend/src/app.html']
  : explicit ?? [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])];

const backendFiles = changed.filter((f) => /^backend\/(src|prisma)\//.test(f) && existsSync(path.join(root, f)));
const frontendFiles = changed.filter((f) => /^frontend\/src\//.test(f));

function bin(dir, pkg, name) {
  const manifest = path.join(root, dir, 'node_modules', pkg, 'package.json');
  if (!existsSync(manifest)) throw new Error(`Missing ${pkg} in ${dir}. Run npm ci --prefix ${dir}.`);
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  const rel = typeof m.bin === 'string' ? m.bin : m.bin?.[name];
  return path.join(root, dir, 'node_modules', pkg, rel);
}

const failures = [];
function run(label, dir, entry, entryArgs, env = {}) {
  process.stdout.write(`\n[verify] ${label}\n`);
  const r = spawnSync(process.execPath, [entry, ...entryArgs], {
    cwd: path.join(root, dir),
    stdio: 'inherit',
    env: { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', ...env }
  });
  if (r.status !== 0) failures.push(label);
}

if (!backendFiles.length && !frontendFiles.length) {
  console.log('[verify] no backend/frontend source changes — nothing to check');
  process.exit(0);
}

if (backendFiles.length) {
  if (backendFiles.some((f) => f.startsWith('backend/prisma/'))) {
    run('backend: prisma generate', 'backend', bin('backend', 'prisma', 'prisma'), ['generate'], {
      DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:5432/offline_validation?schema=public'
    });
  }
  run('backend: tsc --noEmit (build config; specs are type-checked by jest)', 'backend', bin('backend', 'typescript', 'tsc'), ['--noEmit', '-p', 'tsconfig.build.json']);
  const related = backendFiles.filter((f) => f.endsWith('.ts')).map((f) => path.relative(path.join(root, 'backend'), path.join(root, f)));
  const jestArgs = all || !related.length
    ? ['--runInBand', '--watchman=false']
    : ['--runInBand', '--watchman=false', '--passWithNoTests', '--findRelatedTests', ...related];
  run(`backend: jest ${all ? '(all)' : `related to ${related.length} file(s)`}`, 'backend', bin('backend', 'jest', 'jest'), jestArgs);
}

if (frontendFiles.length) {
  run('frontend: svelte-kit sync', 'frontend', bin('frontend', '@sveltejs/kit', 'svelte-kit'), ['sync']);
  run('frontend: svelte-check', 'frontend', bin('frontend', 'svelte-check', 'svelte-check'), ['--tsconfig', './tsconfig.json', '--threshold', 'error', '--output', 'human']);
}

if (failures.length) {
  console.error(`\n[verify] FAIL: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n[verify] PASS');
