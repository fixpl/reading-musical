import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(new URL('../../scripts/setup-production.mjs', import.meta.url));
const secret = 'PRIVATE_SETUP_SENTINEL';
const draftValue = { acts: [{ title: `${secret}_act`, scenes: [{ title: `${secret}_scene`, lines: [{ text: `${secret}_dialogue`, character: `${secret}_actor` }], cues: [{ note: `${secret}_cue` }] }] }] };
const loginValue = { tokens: { accessToken: `${secret}_token` }, user: { platformRole: `${secret}_role` } };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const pathOf = (url) => new URL(url).pathname;

async function fixture(t, state) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'setup-production-contract-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'backend'));
  await writeFile(join(root, 'backend', '.env'), `SEED_ADMIN_EMAIL=${secret}@example.test\nSEED_ADMIN_PASSWORD=${secret}_password\n`);
  const statePath = join(root, '.local-dev', 'setup-production.json');
  if (state !== undefined) {
    await mkdir(dirname(statePath));
    await writeFile(statePath, typeof state === 'string' ? state : JSON.stringify(state), { mode: 0o644 });
  }
  const copiedScript = join(root, 'scripts', 'setup-production.mjs');
  await mkdir(dirname(copiedScript));
  await copyFile(scriptPath, copiedScript);
  const originalFetch = globalThis.fetch;
  let runSetupProduction;
  try {
    globalThis.fetch = () => { throw new Error('IMPORT_FETCH_FORBIDDEN'); };
    ({ runSetupProduction } = await import(pathToFileURL(copiedScript).href));
  } finally { globalThis.fetch = originalFetch; }
  const sourcePath = join(root, `${secret}_script.txt`);
  await writeFile(sourcePath, `${secret}_script_content`);
  const logs = [], requests = [];
  const run = (argv, handler) => runSetupProduction({ root, argv, log: (line) => logs.push(line), fetch: async (url, options = {}) => {
    requests.push({ url, ...options });
    return handler(url, options);
  } });
  const stored = async () => JSON.parse(await readFile(statePath, 'utf8'));
  const assertPrivateOutput = () => {
    const output = logs.join('\n');
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes(root));
    assert.ok(!output.includes('Bearer'));
    assert.ok(!output.includes('https://'));
    assert.ok(logs.every((line) => line.startsWith('[setup] ')));
  };
  return { root, statePath, sourcePath, copiedScript, runSetupProduction, logs, requests, run, stored, assertPrivateOutput };
}

function draftHandler(url) {
  const path = pathOf(url);
  if (path.endsWith('/auth/login')) return json(loginValue);
  if (path.endsWith('/productions')) return json({ id: 'production-test' });
  if (path.endsWith('/ai/extract')) return json({ text: `${secret}_text`, chars: 123 });
  if (path.endsWith('/ai/cue-draft/stream')) {
    const encoded = `${JSON.stringify({ type: 'progress', done: 1, total: 2 })}\n${JSON.stringify({ type: 'result', draft: draftValue, stats: { raw: secret } })}\n`;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(encoded.slice(0, 17)));
      controller.enqueue(new TextEncoder().encode(encoded.slice(17)));
      controller.close();
    } }));
  }
  assert.fail('Unexpected mock request');
}

// 별도 프로세스에서도 import가 기존 환경·CLI·네트워크를 실행하지 않는지 확인한다.
test('import has no console, environment read or fetch side effects', async (t) => {
  const f = await fixture(t);
  await rm(join(f.root, 'backend', '.env'));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `globalThis.fetch = () => { throw new Error('IMPORT_FETCH_FORBIDDEN'); }; await import(${JSON.stringify(pathToFileURL(f.copiedScript).href)});`], { encoding: 'utf8', timeout: 5000, cwd: tmpdir(), env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('unknown command stops before files or requests and emits a fixed argument code', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run([`${secret}_command`], () => assert.fail()), 2);
  assert.deepEqual(f.logs, ['[setup] 실패 code=SETUP_ARGUMENTS stage=arguments']);
  assert.equal(f.requests.length, 0);
  f.assertPrivateOutput();
});

test('missing environment file is caught without filesystem details', async (t) => {
  const f = await fixture(t);
  const logs = [];
  assert.equal(await f.runSetupProduction({ root: join(f.root, secret), argv: ['apply'], log: (line) => logs.push(line), fetch: () => assert.fail() }), 1);
  assert.deepEqual(logs, ['[setup] 실패 code=SETUP_FAILED stage=env-read']);
});

test('corrupt retry JSON is caught and existing mode is restricted before parsing', async (t) => {
  const f = await fixture(t, `{"${secret}":`);
  assert.equal(await f.run(['apply'], () => assert.fail()), 1);
  assert.deepEqual(f.logs, ['[setup] 실패 code=SETUP_STATE_INVALID stage=state-read']);
  assert.equal((await stat(f.statePath)).mode & 0o777, 0o600);
  assert.equal(f.requests.length, 0);
  f.assertPrivateOutput();
});

test('invalid retry JSON shape cannot become command state', async (t) => {
  for (const state of ['null', '[]', '"PRIVATE_SETUP_SENTINEL"']) {
    const f = await fixture(t, state);
    assert.equal(await f.run(['apply'], () => assert.fail()), 1);
    assert.deepEqual(f.logs, ['[setup] 실패 code=SETUP_STATE_INVALID stage=state-read']);
    f.assertPrivateOutput();
  }
});

test('HTTP JSON failure body is never consumed or logged', async (t) => {
  const f = await fixture(t, { productionId: 'production-test', draft: draftValue });
  let bodyRead = false;
  assert.equal(await f.run(['apply'], () => ({ ok: false, status: 401, async text() { bodyRead = true; return JSON.stringify({ message: secret, code: secret }); } })), 1);
  assert.equal(bodyRead, false);
  assert.deepEqual(f.logs, ['[setup] 실패 code=SETUP_HTTP_ERROR stage=login status=401']);
  f.assertPrivateOutput();
});

test('HTTP string failure body is never consumed or logged', async (t) => {
  const f = await fixture(t, { productionId: 'production-test', draft: draftValue });
  let bodyRead = false;
  assert.equal(await f.run(['apply'], () => ({ ok: false, status: 403, async text() { bodyRead = true; return `${secret}_raw_http`; } })), 1);
  assert.equal(bodyRead, false);
  assert.deepEqual(f.logs, ['[setup] 실패 code=SETUP_HTTP_ERROR stage=login status=403']);
  f.assertPrivateOutput();
});

test('arbitrary network message, code, path and cause do not enter output', async (t) => {
  const f = await fixture(t, { productionId: 'production-test', draft: draftValue });
  assert.equal(await f.run(['apply'], () => { throw Object.assign(new Error(secret, { cause: new Error(secret) }), { code: secret, path: secret, status: 402 }); }), 1);
  assert.deepEqual(f.logs, ['[setup] 실패 code=SETUP_FAILED stage=login']);
  f.assertPrivateOutput();
});

test('AI HTTP failure keeps created production for retry without reading provider body', async (t) => {
  const f = await fixture(t);
  let bodyRead = false;
  assert.equal(await f.run(['draft', '--script', f.sourcePath, '--title', `${secret}_production`], (url) => pathOf(url).endsWith('/stream') ? { ok: false, status: 503, async text() { bodyRead = true; return secret; } } : draftHandler(url)), 1);
  assert.equal(bodyRead, false);
  assert.equal(f.logs.at(-1), '[setup] 실패 code=SETUP_AI_HTTP_ERROR stage=ai-request status=503');
  assert.deepEqual(await f.stored(), { productionId: 'production-test' });
  f.assertPrivateOutput();
});

test('AI stream error exposes only fixed stage, code and bounded numeric status', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(['draft', '--script', f.sourcePath, '--title', secret], (url) => pathOf(url).endsWith('/stream') ? new Response(`${JSON.stringify({ type: 'error', status: 429, message: secret, code: secret })}\n`) : draftHandler(url)), 1);
  assert.equal(f.logs.at(-1), '[setup] 실패 code=SETUP_AI_FAILED stage=ai-stream status=429');
  assert.deepEqual(await f.stored(), { productionId: 'production-test' });
  f.assertPrivateOutput();
});

test('AI invalid status and progress values cannot inject text or misleading counts', async (t) => {
  for (const status of [secret, '429', 999, 99, 429.5]) {
    const f = await fixture(t);
    const events = `${JSON.stringify({ type: 'progress', done: secret, total: secret })}\n${JSON.stringify({ type: 'error', status, message: secret })}\n`;
    assert.equal(await f.run(['draft', '--script', f.sourcePath, '--title', secret], (url) => pathOf(url).endsWith('/stream') ? new Response(events) : draftHandler(url)), 1);
    assert.equal(f.logs.at(-1), '[setup] 실패 code=SETUP_AI_FAILED stage=ai-stream');
    assert.ok(!f.logs.some((line) => line.includes('AI 분석 진행')));
    f.assertPrivateOutput();
  }
});

test('malformed stream JSON never logs source text or parser excerpts', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(['draft', '--script', f.sourcePath, '--title', secret], (url) => pathOf(url).endsWith('/stream') ? new Response(`{"${secret}":\n`) : draftHandler(url)), 1);
  assert.equal(f.logs.at(-1), '[setup] 실패 code=SETUP_AI_STREAM_INVALID stage=ai-stream');
  assert.deepEqual(await f.stored(), { productionId: 'production-test' });
  f.assertPrivateOutput();
});

test('script file failure keeps production state and hides filename and path', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(['draft', '--script', join(f.root, `${secret}_missing.txt`), '--title', secret], draftHandler), 1);
  assert.equal(f.logs.at(-1), '[setup] 실패 code=SETUP_FAILED stage=script-read');
  assert.deepEqual(await f.stored(), { productionId: 'production-test' });
  f.assertPrivateOutput();
});

test('mapping parse failure preserves retry state and hides source excerpt', async (t) => {
  const initial = { productionId: 'production-test', scriptId: 'script-test', draft: draftValue, composed: true };
  const f = await fixture(t, initial);
  const mappingPath = join(f.root, `${secret}_map.json`);
  await writeFile(mappingPath, `{"${secret}":`);
  assert.equal(await f.run(['media', '--media', f.root, '--map', mappingPath], draftHandler), 1);
  assert.equal(f.logs.at(-1), '[setup] 실패 code=SETUP_FAILED stage=mapping-read');
  assert.deepEqual(await f.stored(), initial);
  f.assertPrivateOutput();
});

test('draft, apply and media preserve request order, state keys and completed-step skips', async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(['draft', '--script', f.sourcePath, '--title', `${secret}_production`], draftHandler), 0);
  assert.deepEqual(f.requests.map(({ url }) => pathOf(url)), ['/api/v1/auth/login', '/api/v1/productions', '/api/v1/productions/production-test/ai/extract', '/api/v1/productions/production-test/ai/cue-draft/stream']);
  const initialDraft = await f.stored();
  assert.deepEqual(initialDraft, { productionId: 'production-test', draft: draftValue, scriptTitle: `${secret}_production` });
  assert.ok(f.logs.includes('[setup] AI 분석 진행 done=1 total=2'));
  assert.ok(f.logs.includes('[setup] 초안 집계 막=1 장면=1 대사=1 큐=1'));
  assert.equal((await stat(f.statePath)).mode & 0o777, 0o600);
  let compositionApplied = false, mediaLinked = false;
  const handler = (url, options) => {
    const path = pathOf(url);
    if (path.endsWith('/auth/login')) return json(loginValue);
    if (path.endsWith('/ai/cue-draft/apply')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { scriptTitle: `${secret}_production`, draft: draftValue });
      return json({ scriptId: 'script-test', raw: secret });
    }
    if (path.endsWith('/composition/imports/preview')) return json({ sections: [{ title: secret }] });
    if (path.endsWith('/composition/imports/apply')) { compositionApplied = true; return json({ ids: ['section-test'], raw: secret }); }
    if (path.endsWith('/composition')) return json({ revision: mediaLinked ? 4 : compositionApplied ? 3 : 2, sections: [{ id: 'section-test', title: `${secret}_section`, timing: { durationMs: 1000 }, media: mediaLinked ? [{ slot: 'BACKGROUND' }] : [] }] });
    if (path.endsWith('/assets')) {
      assert.equal(JSON.parse(options.body).fileName, `${secret}_video.mp4`);
      return json({ asset: { id: 'asset-test' }, upload: { url: `https://storage.example.test/${secret}?signature=${secret}`, method: 'PUT' } });
    }
    if (new URL(url).hostname === 'storage.example.test') return new Response('', { status: 200 });
    if (path.endsWith('/media')) { mediaLinked = true; return json({ raw: secret }); }
    assert.fail('Unexpected mock request');
  };
  f.requests.length = 0;
  assert.equal(await f.run(['apply'], handler), 0);
  assert.deepEqual(f.requests.map(({ url }) => pathOf(url)), ['/api/v1/auth/login', '/api/v1/productions/production-test/ai/cue-draft/apply', '/api/v1/productions/production-test/composition', '/api/v1/productions/production-test/composition/imports/preview', '/api/v1/productions/production-test/composition/imports/apply']);
  f.requests.length = 0;
  assert.equal(await f.run(['apply'], handler), 0);
  assert.deepEqual(f.requests.map(({ url }) => pathOf(url)), ['/api/v1/auth/login']);
  const mappingPath = join(f.root, `${secret}_map.json`);
  await writeFile(mappingPath, JSON.stringify({ library: [`${secret}_video.mp4`], sections: [{ match: secret, video: `${secret}_video.mp4` }, { match: `${secret}_not_found`, video: `${secret}_video.mp4` }] }));
  await writeFile(join(f.root, `${secret}_video.mp4`), 'test-only-media');
  f.requests.length = 0;
  assert.equal(await f.run(['media', '--media', f.root, '--map', mappingPath], handler), 0);
  assert.deepEqual(f.requests.map(({ url }) => pathOf(url)), ['/api/v1/auth/login', '/api/v1/assets', `/${secret}`, '/api/v1/productions/production-test/composition', '/api/v1/productions/production-test/composition', '/api/v1/productions/production-test/composition/sections/section-test/media', '/api/v1/productions/production-test/composition']);
  const stored = await f.stored();
  assert.deepEqual(stored, { ...initialDraft, scriptId: 'script-test', composed: true, assets: { [`${secret}_video.mp4`]: 'asset-test' } });
  assert.ok(!JSON.stringify(stored).includes(loginValue.tokens.accessToken));
  assert.equal((await stat(f.statePath)).mode & 0o777, 0o600);
  f.requests.length = 0;
  assert.equal(await f.run(['media', '--media', f.root, '--map', mappingPath], handler), 0);
  assert.ok(f.requests.every(({ url }) => !pathOf(url).endsWith('/assets') && new URL(url).hostname !== 'storage.example.test'));
  f.assertPrivateOutput();
});

test('failed composition retains applied script and retry skips script application', async (t) => {
  const f = await fixture(t, { productionId: 'production-test', draft: draftValue, scriptTitle: secret });
  const handler = (url) => {
    const path = pathOf(url);
    if (path.endsWith('/auth/login')) return json(loginValue);
    if (path.endsWith('/ai/cue-draft/apply')) return json({ scriptId: 'script-test', raw: secret });
    if (path.endsWith('/composition')) return json({ revision: 1 });
    if (path.endsWith('/imports/preview')) return json({ sections: [] });
    if (path.endsWith('/imports/apply')) return json({ message: secret }, 409);
    assert.fail('Unexpected mock request');
  };
  assert.equal(await f.run(['apply'], handler), 1);
  const stored = await f.stored();
  assert.equal(stored.scriptId, 'script-test');
  assert.equal(stored.composed, undefined);
  f.requests.length = 0;
  assert.equal(await f.run(['apply'], (url) => pathOf(url).endsWith('/imports/apply') ? json({ ids: ['section-test'] }) : handler(url)), 0);
  assert.ok(!f.requests.some(({ url }) => pathOf(url).endsWith('/ai/cue-draft/apply')));
  assert.equal((await f.stored()).composed, true);
  f.assertPrivateOutput();
});

test('failed second media upload retains first asset and retry uploads only unfinished file', async (t) => {
  const f = await fixture(t, { productionId: 'production-test', draft: draftValue, composed: true });
  const files = [`${secret}_first.mp4`, `${secret}_second.mp4`];
  for (const file of files) await writeFile(join(f.root, file), 'test-only-media');
  const mappingPath = join(f.root, `${secret}_map.json`);
  await writeFile(mappingPath, JSON.stringify({ library: files, sections: [] }));
  let secondFails = true, reserved = [];
  const handler = (url, options) => {
    const path = pathOf(url);
    if (path.endsWith('/auth/login')) return json(loginValue);
    if (path.endsWith('/assets')) {
      const file = JSON.parse(options.body).fileName;
      reserved.push(file);
      return json({ asset: { id: `asset-${file === files[0] ? 'first' : 'second'}` }, upload: { url: `https://storage.example.test/${file}?signature=${secret}` } });
    }
    if (new URL(url).hostname === 'storage.example.test') return new Response(secret, { status: path.includes('second') && secondFails ? 500 : 200 });
    assert.fail('Unexpected mock request');
  };
  const argv = ['media', '--media', f.root, '--map', mappingPath];
  assert.equal(await f.run(argv, handler), 1);
  assert.equal(f.logs.at(-1), '[setup] 실패 code=SETUP_UPLOAD_ERROR stage=media-upload status=500');
  assert.deepEqual((await f.stored()).assets, { [files[0]]: 'asset-first' });
  secondFails = false;
  reserved = [];
  assert.equal(await f.run(argv, handler), 0);
  assert.deepEqual(reserved, [files[1]]);
  assert.deepEqual((await f.stored()).assets, { [files[0]]: 'asset-first', [files[1]]: 'asset-second' });
  f.assertPrivateOutput();
});

test('reuse-draft preserves content and adjusts legacy state permission without AI request', async (t) => {
  const initial = { productionId: 'production-test', draft: draftValue, scriptTitle: 'old-title', assets: { existing: 'asset-test' } };
  const f = await fixture(t, initial);
  assert.equal(await f.run(['draft', '--script', f.sourcePath, '--title', secret, '--reuse-draft', 'true'], draftHandler), 0);
  assert.deepEqual(f.requests.map(({ url }) => pathOf(url)), ['/api/v1/auth/login']);
  assert.deepEqual(await f.stored(), { ...initial, scriptTitle: secret });
  assert.equal((await stat(f.statePath)).mode & 0o777, 0o600);
  f.assertPrivateOutput();
});

test('direct CLI contains filesystem and network exceptions in stdout/stderr', async (t) => {
  const f = await fixture(t, { productionId: 'production-test', draft: draftValue });
  const copiedScript = f.copiedScript;
  const preload = join(f.root, 'mock-fetch.mjs');
  await writeFile(preload, `globalThis.fetch = async () => { throw Object.assign(new Error('${secret}'), { code: '${secret}', cause: new Error('${secret}') }); };`);
  const result = spawnSync(process.execPath, ['--import', preload, copiedScript, 'apply'], { encoding: 'utf8', timeout: 5000, cwd: f.root, env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '[setup] 실패 code=SETUP_FAILED stage=login\n');
  assert.equal(result.stderr, '');
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(f.root));
  await writeFile(f.statePath, `{"${secret}":`);
  const corrupt = spawnSync(process.execPath, ['--import', preload, copiedScript, 'apply'], { encoding: 'utf8', timeout: 5000, cwd: f.root, env: { PATH: process.env.PATH } });
  assert.equal(corrupt.status, 1);
  assert.equal(corrupt.stdout, '[setup] 실패 code=SETUP_STATE_INVALID stage=state-read\n');
  assert.equal(corrupt.stderr, '');
});
