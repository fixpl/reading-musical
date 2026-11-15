/* Fixed offline quality gates: execute installed Node CLIs without nested npm shell launchers. */
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const task = process.argv[2];
const plans = {
  check: [
    ['backend', 'prisma', 'prisma', 'validate'],
    ['backend', 'prisma', 'prisma', 'generate'],
    ['backend', '@nestjs/cli', 'nest', 'build'],
    ['frontend', '@sveltejs/kit', 'svelte-kit', 'sync'],
    ['frontend', 'svelte-check', 'svelte-check', '--tsconfig', './tsconfig.json']
  ],
  test: [
    ['backend', 'prisma', 'prisma', 'generate'],
    ['backend', '@nestjs/cli', 'nest', 'build'],
    ['backend', 'jest', 'jest', '--runInBand', '--watchman=false']
  ],
  build: [
    ['backend', 'prisma', 'prisma', 'generate'],
    ['backend', '@nestjs/cli', 'nest', 'build'],
    ['frontend', 'vite', 'vite', 'build']
  ]
};
if (!Object.prototype.hasOwnProperty.call(plans, task)) {
  console.error('Usage: node tests/run-quality.cjs check|test|build');
  process.exit(1);
}
function run(entry, args, cwd, label, extraEnv = {}) {
  console.log(`\n[quality:${task}] ${label}`);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    stdio: 'inherit',
    shell: false,
    timeout: 110000,
    env: { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', ...extraEnv }
  });
  if (result.error || result.signal || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    if (result.signal) console.error(`Terminated by ${result.signal}`);
    process.exit(result.status || 1);
  }
}
try {
  for (const [directory, packageName, binName, ...args] of plans[task]) {
    const cwd = path.join(root, directory);
    const packageDirectory = path.join(cwd, 'node_modules', packageName);
    const manifestPath = path.join(packageDirectory, 'package.json');
    if (!existsSync(manifestPath)) throw new Error(`Missing ${packageName}. Install the ${directory} dependencies first with npm ci.`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
    if (typeof bin !== 'string') throw new Error(`Missing installed CLI ${binName}`);
    const entry = path.resolve(packageDirectory, bin);
    const relative = path.relative(packageDirectory, entry);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Invalid CLI path for ${packageName}`);
    // validate/generate need a syntactically valid URL, but never connect or migrate.
    // Use a non-production placeholder even when the caller has real credentials.
    const extraEnv = packageName === 'prisma'
      ? { DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:5432/offline_validation?schema=public' }
      : {};
    run(entry, args, cwd, `${directory}: ${binName} ${args.join(' ')}`, extraEnv);
  }
  if (task === 'test') {
    run(path.join(root, 'tests/smoke/production-cache-contract.cjs'), [], root, 'production account isolation regression');
    run(path.join(root, 'tests/smoke/client-session-boundary-contract.cjs'), [], root, 'client session ownership and refresh race regression');
    run(path.join(root, 'tests/smoke/registration-email-contract.cjs'), [], root, 'registration email proof and session ownership regression');
    run(path.join(root, 'tests/smoke/workspace-navigation-contract.cjs'), [], root, 'workspace feature navigation regression');
    run(path.join(root, 'tests/smoke/media-session-boundary-contract.cjs'), [], root, 'media upload session ownership regression');
    run(path.join(root, 'tests/smoke/showcase-image-upload-contract.cjs'), [], root, 'showcase local preview and deferred image upload regression');
    run(path.join(root, 'tests/smoke/cuesheet-import-session-contract.cjs'), [], root, 'cuesheet import session ownership regression');
    run(path.join(root, 'tests/smoke/staff-assignment-editor-contract.cjs'), [], root, 'staff assignment custom label and preservation regression');
    run(path.join(root, 'tests/smoke/rehearsal-timeline-contract.cjs'), [], root, 'composition rehearsal regression');
    run(path.join(root, 'tests/smoke/reader-preferences-contract.cjs'), [], root, 'reader preferences regression');
    run(path.join(root, 'tests/smoke/checklist-state-contract.cjs'), [], root, 'checklist request and draft state regression');
    run(path.join(root, 'tests/smoke/operations-dashboard-contract.cjs'), [], root, 'operations dashboard counts and status regression');
    run(path.join(root, 'tests/smoke/scene-line-draft-contract.cjs'), [], root, 'scene line unsaved draft regression');
    run(path.join(root, 'tests/smoke/guest-reading-lifecycle-contract.cjs'), [], root, 'guest reading access lifecycle regression');
    run(path.join(root, 'tests/smoke/community-realtime-contract.cjs'), [], root, 'community realtime invalidation regression');
    run(path.join(root, 'tests/smoke/performance-timeline-contract.cjs'), [], root, 'performance timeline regression');
    run(path.join(root, 'tests/smoke/timeline-export-contract.cjs'), [], root, 'timeline video export regression');
    run(path.join(root, 'tests/smoke/confirm-dialog-contract.cjs'), [], root, 'confirm dialog contract regression');
    run(path.join(root, 'tests/smoke/local-dev-contract.mjs'), [], root, 'local launcher safety regression');
    run(path.join(root, 'tests/smoke/setup-production-contract.mjs'), [], root, 'production setup output privacy and retry regression');
    run(path.join(root, 'tests/smoke/ui-standard-contract.cjs'), [], root, 'ui standard components regression');
  }
  console.log(`\n[quality:${task}] PASS`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
