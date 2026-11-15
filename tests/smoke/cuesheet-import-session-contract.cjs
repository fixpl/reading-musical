const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const component = fs.readFileSync(path.join(root, 'frontend/src/lib/components/app/cuesheet-import-dialog.svelte'), 'utf8');
const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const tree = ts.createSourceFile('cuesheet-import.ts', script, ts.ScriptTarget.ES2022, true);
const body = tree.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(tree)).join('\n');
const csv = '큐번호\t부서\t내용\n조01\t조명\t배우 입장 전 조명';
const token = (owner, serial = 1) => `header.${Buffer.from(JSON.stringify({ sub: owner, serial })).toString('base64url')}.signature`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

/** 실제 component script·session·API client를 실행하고 파일 읽기와 HTTP 응답만 제어한다. */
function setup(respond = async (_url, init) => {
  const document = JSON.parse(init.body);
  return json(document.dryRun ? { total: document.rows.length, newTracks: [], sceneLinked: 0, warnings: [] } : { created: document.rows.length, newTracks: [] });
}, onDone = async () => {}) {
  const values = new Map(), modules = new Map(), effects = [], destroys = [], requests = [], toasts = [];
  let done = 0, closed = 0, parses = 0;
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  const globals = { localStorage, document: { cookie: '' }, Headers, Response, AbortController, DOMException, atob, FormData, ReadableStream, TextDecoder, URL,
    fetch: async (url, init) => { requests.push({ url, init }); return respond(url, init); } };
  function evaluate(source, require, extra = {}) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const scope = { ...globals, ...extra };
    new Function('module', 'exports', 'require', ...Object.keys(scope), compiled)(module, module.exports, require, ...Object.values(scope));
    return module.exports;
  }
  function load(name) {
    if (name === '$env/dynamic/public') return { env: {} };
    const filename = name.replace(/^\.\//, '');
    if (modules.has(filename)) return modules.get(filename);
    const loaded = evaluate(fs.readFileSync(path.join(root, 'frontend/src/lib/api', `${filename}.ts`), 'utf8'), load);
    modules.set(filename, loaded);
    return loaded;
  }
  const session = load('session'), client = load('client');
  const parser = evaluate(fs.readFileSync(path.join(root, 'frontend/src/lib/domain/cuesheet-import.ts'), 'utf8'), () => { throw new Error('unexpected import'); });
  const setAccount = (owner, serial = 1) => {
    localStorage.setItem(session.ACCESS_TOKEN_KEY, token(owner, serial));
    session.captureSession();
  };
  setAccount('actor-a');
  const props = { pid: 'production-a', onClose: () => { closed += 1; }, onDone: async () => { done += 1; await onDone(); } };
  const page = evaluate(`${body}
    module.exports = { pick, analyze, commit, close,
      editSource(value) { text = value; invalidatePreview(); },
      setPid(value) { pid = value; for (const effect of effects) effect(); },
      dispose() { for (const destroy of destroys) destroy(); },
      state: () => ({ text, fileName, rows, preview, working, error }) };
  `, () => { throw new Error('unexpected component import'); }, {
    apiRequest: client.apiRequest, captureSession: session.captureSession, isCurrentSession: session.isCurrentSession,
    onDestroy: (callback) => destroys.push(callback), untrack: (callback) => callback(),
    $state: (value) => value, $props: () => props, $effect: (callback) => { effects.push(callback); callback(); }, effects, destroys,
    parseCuesheet: (source) => { parses += 1; return parser.parseCuesheet(source); },
    toast: { success: (message) => toasts.push(message) }
  });
  const pick = (content = csv) => page.pick({ currentTarget: { files: [{ name: 'private.csv', size: 100, text: () => Promise.resolve(content) }], value: 'file' } });
  const file = (pending) => page.pick({ currentTarget: { files: [{ name: 'private.csv', size: 100, text: () => pending.promise }], value: 'file' } });
  return { ...page, pick, file, setAccount, requests, toasts, parses: () => parses, done: () => done, closed: () => closed };
}

test('delayed file.text cannot parse or preview account A CSV after switching to B', async () => {
  const page = setup(), file = deferred();
  const reading = page.file(file);
  page.setAccount('actor-b');
  file.resolve(csv);
  await reading;
  assert.equal(page.requests.length, 0);
  assert.equal(page.parses(), 0);
  assert.equal(page.state().text, '');
  assert.deepEqual(page.state().rows, []);
  await page.commit(); page.close();
  assert.equal(page.requests.length, 0);
  assert.equal(page.closed(), 0);
});

test('destroyed dialog cannot start a write or invoke callbacks after pending file work', async () => {
  const page = setup(), file = deferred();
  const reading = page.file(file);
  page.dispose();
  file.resolve(csv);
  await reading;
  await page.analyze(csv); await page.commit(); page.close();
  assert.equal(page.requests.length, 0);
  assert.equal(page.parses(), 0);
  assert.equal(page.done(), 0);
  assert.equal(page.closed(), 0);
  assert.deepEqual(page.toasts, []);
});

test('same-owner token refresh preserves pending file preview and commit with the new credential', async () => {
  const page = setup(), file = deferred();
  const reading = page.file(file);
  page.setAccount('actor-a', 2);
  file.resolve(csv);
  await reading;
  await page.commit();
  assert.equal(page.requests.length, 2);
  assert.ok(page.requests.every(({ init }) => init.headers.get('authorization') === `Bearer ${token('actor-a', 2)}`));
  assert.equal(JSON.parse(page.requests[0].init.body).dryRun, true);
  assert.equal(JSON.parse(page.requests[1].init.body).dryRun, undefined);
  assert.equal(page.done(), 1);
  assert.equal(page.closed(), 1);
  assert.equal(page.toasts.length, 1);
  assert.equal(page.state().working, false);
});

test('production changes discard a pending old CSV and allow a fresh preview for the new production', async () => {
  const page = setup(), file = deferred();
  const reading = page.file(file);
  page.setPid('production-b');
  file.resolve(csv);
  await reading; await page.commit();
  assert.equal(page.requests.length, 0);
  assert.equal(page.state().text, '');
  await page.pick(); await page.commit();
  assert.equal(page.requests.length, 2);
  assert.ok(page.requests.every(({ url }) => url.includes('/productions/production-b/')));
});

test('a previously previewed CSV cannot be committed after changing production', async () => {
  const page = setup();
  await page.pick();
  page.setPid('production-b');
  await page.commit();
  assert.equal(page.requests.length, 1);
  assert.equal(page.state().preview, null);
  assert.deepEqual(page.state().rows, []);
});

test('editing previewed text requires new analysis and commits exactly the edited rows', async () => {
  const page = setup();
  await page.pick();
  const edited = csv.replace('배우 입장 전 조명', '마지막 장면의 암전');
  page.editSource(edited);
  await page.commit();
  assert.equal(page.requests.length, 1);
  assert.equal(page.state().preview, null);
  assert.deepEqual(page.state().rows, []);
  await page.analyze(edited); await page.commit();
  assert.equal(page.requests.length, 3);
  const registered = JSON.parse(page.requests[2].init.body).rows;
  assert.equal(registered[0].content, '마지막 장면의 암전');
});

test('an old file rejection cannot change the new production request state', async () => {
  const page = setup(), first = deferred(), second = deferred();
  const oldReading = page.file(first);
  page.setPid('production-b');
  const newReading = page.file(second);
  first.reject(new Error('old failure'));
  await oldReading;
  assert.equal(page.state().working, true);
  assert.equal(page.state().error, '');
  second.resolve(csv); await newReading;
  assert.equal(page.state().working, false);
  assert.equal(page.state().preview.total, 1);
});

test('late commit response after an account switch cannot toast, reload, or close the new UI', async () => {
  const commit = deferred(), started = deferred();
  const page = setup(async (_url, init) => {
    if (JSON.parse(init.body).dryRun) return json({ total: 1, newTracks: [], sceneLinked: 0, warnings: [] });
    started.resolve(); return commit.promise;
  });
  await page.pick();
  const saving = page.commit();
  await started.promise;
  page.setAccount('actor-b');
  commit.resolve(json({ created: 1, newTracks: [] }));
  await saving;
  assert.equal(page.requests.length, 2);
  assert.equal(page.done(), 0);
  assert.equal(page.closed(), 0);
  assert.deepEqual(page.toasts, []);
});

test('a delayed onDone callback cannot close a dialog after account change', async () => {
  const callback = deferred(), started = deferred();
  const page = setup(undefined, async () => { started.resolve(); await callback.promise; });
  await page.pick();
  const saving = page.commit();
  await started.promise;
  page.setAccount('actor-b');
  callback.resolve();
  await saving;
  assert.equal(page.done(), 1);
  assert.equal(page.closed(), 0);
});

test('returning to the previous owner cannot revive file work from before the account switch', async () => {
  const page = setup(), file = deferred();
  const reading = page.file(file);
  page.setAccount('actor-b'); page.setAccount('actor-a', 3);
  file.resolve(csv); await reading;
  assert.equal(page.requests.length, 0);
  assert.equal(page.parses(), 0);
});

test('a failed current commit preserves its preview for an explicit retry', async () => {
  let commits = 0;
  const page = setup(async (_url, init) => {
    if (JSON.parse(init.body).dryRun) return json({ total: 1, newTracks: [], sceneLinked: 0, warnings: [] });
    commits += 1;
    return commits === 1 ? json({ message: 'temporary failure' }, 503) : json({ created: 1, newTracks: [] });
  });
  await page.pick(); await page.commit();
  assert.equal(page.state().working, false);
  assert.equal(page.state().error, 'temporary failure');
  await page.commit();
  assert.equal(commits, 2);
  assert.equal(page.done(), 1);
  assert.equal(page.closed(), 1);
});
