const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const apiDir = path.join(root, 'frontend/src/lib/api');
const image = (name = '공연.png', type = 'image/png', body = 'synthetic-image') => new File([body], name, { type });
const token = (owner, serial = 1) => `header.${Buffer.from(JSON.stringify({ sub: owner, serial })).toString('base64url')}.signature`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const draft = () => ({ title: '공연', synopsis: '', description: '소개', venue: '', startDate: null, endDate: null,
  posterAssetId: null, officialUrl: '', ticketUrl: '', videoUrl: '', gallery: [] });

function setup(handle = async () => undefined, extra = {}) {
  const values = new Map(), modules = new Map(), calls = [], created = [], revoked = [];
  let reservations = 0;
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  class PreviewURL extends URL {
    static createObjectURL(file) { const value = `blob:synthetic-${created.length}`; created.push({ value, file }); return value; }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  const globals = { localStorage, document: { cookie: '' }, Headers, Response, AbortController, DOMException, atob,
    URL: PreviewURL, crypto: webcrypto, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      const call = { url, init, body: typeof init.body === 'string' && url.endsWith('/assets') ? JSON.parse(init.body) : init.body };
      calls.push(call);
      const supplied = await handle(call);
      if (supplied) return supplied;
      if (url.endsWith('/assets')) {
        const id = `asset-${++reservations}`;
        return json({ asset: { id }, upload: { url: `https://storage.invalid/${id}`, method: 'PUT', expiresAt: '2999-01-01T00:00:00.000Z' } });
      }
      return new Response('', { status: 200 });
    }, ...extra };
  function evaluate(source, require, overrides = {}) {
    const module = { exports: {} }, scope = { ...globals, ...overrides };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('module', 'exports', 'require', ...Object.keys(scope), code)(module, module.exports, require, ...Object.values(scope));
    return module.exports;
  }
  function load(name) {
    if (name === '$env/dynamic/public') return { env: {} };
    const file = name.replace(/^\$lib\/api\//, '').replace(/^\.\//, '');
    if (!modules.has(file)) modules.set(file, evaluate(fs.readFileSync(path.join(apiDir, `${file}.ts`), 'utf8'), load));
    return modules.get(file);
  }
  const session = load('session'), client = load('client'), helper = load('showcase-image-upload');
  function account(owner, serial = 1) { client.saveTokens({ accessToken: token(owner, serial) }); return session.captureSession(); }
  account('producer-a');
  return { helper, session, client, account, calls, created, revoked, evaluate,
    create: file => helper.createPendingShowcaseImage(file ?? image()),
    run: (document, pending, owner = session.captureSession(), progress) => helper.uploadPendingShowcaseImages('production-a', document, pending, owner, progress) };
}

test('selection, removal and cancellation keep image bytes and credentials inside the browser', () => {
  const app = setup();
  const file = image();
  file.arrayBuffer = () => { throw new Error('Selection must not read or hash bytes'); };
  const item = app.create(file);
  assert.match(item.id, /^local:[0-9a-f-]{36}$/);
  assert.equal(item.previewUrl, 'blob:synthetic-0');
  assert.equal(item.file, file);
  assert.equal(item.session.owner, 'producer-a');
  assert.equal(app.calls.length, 0);
  app.helper.revokePendingShowcaseImage(item);
  assert.deepEqual(app.revoked, [item.previewUrl]);
  assert.equal(app.calls.length, 0);
});

test('selection checks PNG/JPEG/WebP MIME, matching extension and size before allocating a preview', () => {
  const app = setup();
  for (const file of [image('a.svg', 'image/svg+xml'), image('a.jpg', 'image/png'), image('a.png', 'text/html'),
    image('a', 'image/png'), image('a.png', 'image/png', ''), image('a.png', 'image/png', Buffer.alloc(10 * 1024 * 1024 + 1))]) {
    assert.throws(() => app.create(file), /10MB/);
  }
  assert.equal(app.created.length, 0);
  assert.equal(app.create(image('a.JPEG', '')).mimeType, 'image/jpeg');
  assert.equal(app.create(image('a.webp', 'application/octet-stream')).mimeType, 'image/webp');
  assert.equal(app.create(image('a.png', 'image/png', Buffer.alloc(10 * 1024 * 1024))).file.size, 10 * 1024 * 1024);
  assert.equal(app.calls.length, 0);
});

test('save uploads referenced images in poster/gallery order, deduplicates references and returns a separate document', async () => {
  const app = setup(), poster = app.create(), gallery = app.create(image('홍보.jpg', 'image/jpeg')), removed = app.create();
  const document = { ...draft(), posterAssetId: poster.id, gallery: [{ assetId: gallery.id, caption: '사진' }, { assetId: poster.id, caption: '같은 포스터' }] };
  const original = structuredClone(document), progress = [];
  const result = await app.run(document, { [poster.id]: poster, [gallery.id]: gallery, [removed.id]: removed }, undefined, (...entry) => progress.push(entry));
  assert.deepEqual(app.calls.map(call => call.init.method), ['POST', 'PUT', 'POST', 'PUT']);
  assert.deepEqual(app.calls.filter(call => call.init.method === 'POST').map(call => call.body.fileName), ['공연.png', '홍보.jpg']);
  const reservation = app.calls[0];
  assert.equal(reservation.body.purpose, 'SHOWCASE_IMAGE');
  assert.equal(reservation.body.productionId, 'production-a');
  assert.match(reservation.body.checksum, /^sha256:[a-f0-9]{64}$/);
  assert.equal(new Headers(reservation.init.headers).get('authorization'), `Bearer ${token('producer-a')}`);
  assert.equal(app.calls[1].init.credentials, 'omit');
  assert.equal(new Headers(app.calls[1].init.headers).get('authorization'), null);
  assert.equal(new Headers(app.calls[1].init.headers).get('content-type'), 'image/png');
  assert.equal(result.posterAssetId, 'asset-1');
  assert.deepEqual(result.gallery.map(item => item.assetId), ['asset-2', 'asset-1']);
  assert.deepEqual(document, original);
  assert.notEqual(result.gallery, document.gallery);
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
  assert.equal(removed.productionId, undefined);
  assert.equal(app.revoked.length, 0);
});

test('partial failure preserves successful assets and the failed ticket so a retry reserves and transfers no duplicates', async () => {
  let failed = false;
  const app = setup(async call => {
    if (call.url.endsWith('/asset-2') && !failed) { failed = true; throw new TypeError('synthetic disconnect'); }
  });
  const first = app.create(), second = app.create(), third = app.create();
  const document = { ...draft(), posterAssetId: first.id, gallery: [{ assetId: second.id, caption: '' }, { assetId: third.id, caption: '' }] };
  const pending = Object.fromEntries([first, second, third].map(item => [item.id, item]));
  await assert.rejects(app.run(document, pending), /파일 저장소/);
  assert.equal(first.uploadedAssetId, 'asset-1');
  assert.equal(second.ticket.asset.id, 'asset-2');
  assert.equal(second.uploadedAssetId, undefined);
  assert.equal(third.ticket, undefined);
  assert.equal(document.posterAssetId, first.id);
  const result = await app.run(document, pending);
  assert.equal(result.posterAssetId, 'asset-1');
  assert.deepEqual(result.gallery.map(item => item.assetId), ['asset-2', 'asset-3']);
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 3);
  assert.equal(app.calls.filter(call => call.url.endsWith('/asset-1')).length, 1);
  assert.equal(app.calls.filter(call => call.url.endsWith('/asset-2')).length, 2);
});

test('a draft save retry after completed transfers performs no storage or asset requests', async () => {
  const app = setup(), item = app.create();
  const document = { ...draft(), posterAssetId: item.id }, pending = { [item.id]: item };
  await app.run(document, pending);
  const count = app.calls.length;
  assert.equal((await app.run(document, pending)).posterAssetId, item.uploadedAssetId);
  assert.equal(app.calls.length, count);
});

test('valid upload permission failures keep their ticket; only a known expired unfinished reservation is replaced', async () => {
  let rejectUpload = true;
  const app = setup(async call => call.init.method === 'PUT' && rejectUpload ? new Response('', { status: 403 }) : undefined);
  const item = app.create(), document = { ...draft(), posterAssetId: item.id }, pending = { [item.id]: item };
  await assert.rejects(app.run(document, pending), /저장소 권한/);
  assert.equal(item.ticket.asset.id, 'asset-1');
  await assert.rejects(app.run(document, pending), /저장소 권한/);
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 1);
  item.ticket.upload.expiresAt = '2000-01-01T00:00:00.000Z';
  rejectUpload = false;
  assert.equal((await app.run(document, pending)).posterAssetId, 'asset-2');
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 2);
});

test('another production cannot reuse either an unfinished ticket or a completed asset', async () => {
  const app = setup(), item = app.create(), document = { ...draft(), posterAssetId: item.id }, pending = { [item.id]: item };
  item.productionId = 'production-b';
  item.ticket = { asset: { id: 'foreign-asset' }, upload: { url: 'https://storage.invalid/foreign' } };
  await assert.rejects(app.run(document, pending), { name: 'AbortError' });
  item.uploadedAssetId = 'foreign-asset';
  await assert.rejects(app.run(document, pending), { name: 'AbortError' });
  assert.equal(app.calls.length, 0);
});

test('gallery limit and missing staged images are rejected before reserving any asset', async () => {
  const app = setup(), item = app.create();
  await assert.rejects(app.run({ ...draft(), posterAssetId: item.id, gallery: Array.from({ length: 9 }, () => ({ assetId: item.id, caption: '' })) }, { [item.id]: item }), /8장/);
  await assert.rejects(app.run({ ...draft(), posterAssetId: item.id, gallery: [{ assetId: 'local:missing', caption: '' }] }, { [item.id]: item }), /다시 선택/);
  assert.equal(app.calls.length, 0);
});

test('an account switch or an A to B to A cycle invalidates selected images before any request', async () => {
  const app = setup(), item = app.create(), document = { ...draft(), posterAssetId: item.id }, pending = { [item.id]: item };
  app.account('producer-b');
  await assert.rejects(app.run(document, pending), { name: 'AbortError' });
  app.account('producer-a');
  await assert.rejects(app.run(document, pending), { name: 'AbortError' });
  assert.equal(app.calls.length, 0);
});

test('account changes while hashing stop before asset reservation', async () => {
  const bytes = deferred(), app = setup(), file = image();
  file.arrayBuffer = () => bytes.promise;
  const item = app.create(file), work = app.run({ ...draft(), posterAssetId: item.id }, { [item.id]: item });
  const rejected = assert.rejects(work, { name: 'AbortError' });
  app.account('producer-b');
  bytes.resolve(new Uint8Array([1, 2, 3]).buffer);
  await rejected;
  assert.equal(app.calls.length, 0);
});

test('late reservation response cannot transfer another account’s file', async () => {
  const response = deferred(), started = deferred();
  const app = setup(async call => {
    if (call.init.method === 'POST') { started.resolve(); return response.promise; }
  });
  const item = app.create(), work = app.run({ ...draft(), posterAssetId: item.id }, { [item.id]: item });
  const rejected = assert.rejects(work, { name: 'AbortError' });
  await started.promise;
  app.account('producer-b');
  response.resolve(json({ asset: { id: 'synthetic-late' }, upload: { url: 'https://storage.invalid/late' } }));
  await rejected;
  assert.equal(app.calls.length, 1);
  assert.equal(item.ticket, undefined);
});

test('route cancellation after a late PUT prevents completion and the next image while retaining its retry ticket', async () => {
  const response = deferred(), started = deferred(), route = new AbortController();
  const app = setup(async call => {
    if (call.init.method === 'PUT') { started.resolve(); return response.promise; }
  });
  const first = app.create(), second = app.create();
  const document = { ...draft(), posterAssetId: first.id, gallery: [{ assetId: second.id, caption: '' }] };
  const scoped = { ...app.session.captureSession(), signal: route.signal };
  const work = app.run(document, { [first.id]: first, [second.id]: second }, scoped), rejected = assert.rejects(work, { name: 'AbortError' });
  await started.promise;
  route.abort();
  response.resolve(new Response('', { status: 200 }));
  await rejected;
  assert.equal(app.calls.length, 2);
  assert.equal(first.uploadedAssetId, undefined);
  assert.equal(first.ticket.asset.id, 'asset-1');
  assert.equal(second.ticket, undefined);
});

test('same-owner credential refresh preserves selection and accepts a scoped session without object identity', async () => {
  let app;
  app = setup(async call => { if (call.init.method === 'PUT') app.account('producer-a', 2); });
  const item = app.create(), owner = app.session.captureSession();
  app.account('producer-a', 2);
  const scoped = { ...app.session.captureSession(), signal: new AbortController().signal };
  assert.notEqual(owner.credentialGeneration, scoped.credentialGeneration);
  assert.equal((await app.run({ ...draft(), posterAssetId: item.id }, { [item.id]: item }, scoped)).posterAssetId, 'asset-1');
});

test('concurrent saves for the same pending item share one asset reservation and transfer', async () => {
  const response = deferred(), started = deferred();
  const app = setup(async call => { if (call.init.method === 'PUT') { started.resolve(); return response.promise; } });
  const item = app.create(), document = { ...draft(), posterAssetId: item.id }, pending = { [item.id]: item };
  const one = app.run(document, pending), two = app.run(document, pending);
  await started.promise;
  response.resolve(new Response('', { status: 200 }));
  const results = await Promise.all([one, two]);
  assert.deepEqual(results.map(value => value.posterAssetId), ['asset-1', 'asset-1']);
  assert.equal(app.calls.length, 2);
});

test('a stalled PUT times out without discarding its ticket or changing the draft', async () => {
  const started = deferred();
  const timers = new Map(); let timerId = 0;
  const app = setup(async call => {
    if (call.init.method === 'PUT') {
      started.resolve();
      return new Promise((_resolve, reject) => call.init.signal.addEventListener('abort', () => reject(new DOMException('synthetic abort', 'AbortError')), { once: true }));
    }
  }, { setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) });
  const item = app.create(), document = { ...draft(), posterAssetId: item.id };
  const work = app.run(document, { [item.id]: item }), rejected = assert.rejects(work, /전송 시간이/);
  await started.promise;
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  await rejected;
  assert.equal(item.ticket.asset.id, 'asset-1');
  assert.equal(item.uploadedAssetId, undefined);
  assert.equal(document.posterAssetId, item.id);
  assert.equal(timers.size, 0);
});

function dropzone(props) {
  const app = setup(), source = fs.readFileSync(path.join(root, 'frontend/src/lib/components/showcase/image-dropzone.svelte'), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const code = script + '\nmodule.exports.harness = { selected, dragEnter, dragOver, dragLeave, drop, depth: () => dragDepth };';
  const harness = app.evaluate(code, () => ({}), { $props: () => props, $state: value => value, $derived: value => value }).harness;
  return { ...harness, source };
}

test('dropzone accepts multiple local files, ignores URL drops and prevents browser navigation', () => {
  const batches = [], zone = dropzone({ label: '홍보 사진', multiple: true, onFiles: files => batches.push(files) });
  const files = [image(), image('other.jpg', 'image/jpeg')];
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; }, dataTransfer: { types: ['Files'], files, dropEffect: '' } };
  zone.dragEnter(event); zone.dragEnter(event); zone.dragLeave(event); zone.dragOver(event);
  assert.equal(zone.depth(), 1);
  assert.equal(event.dataTransfer.dropEffect, 'copy');
  zone.drop(event);
  assert.equal(zone.depth(), 0);
  assert.deepEqual(batches, [files]);
  zone.drop({ ...event, dataTransfer: { types: ['text/uri-list'], files: [], getData: () => 'https://example.invalid/photo.jpg' } });
  assert.equal(batches.length, 1);
  assert.equal(prevented, 6);
});

test('dropzone has a keyboard file input, resets repeat selection and suppresses disabled changes', () => {
  const batches = [], zone = dropzone({ label: '포스터', onFiles: files => batches.push(files) });
  const input = { files: [image(), image()], value: 'synthetic-path' };
  zone.selected({ currentTarget: input });
  assert.equal(input.value, '');
  assert.equal(batches[0].length, 1);
  assert.match(zone.source, /aria-label=\{label\}/);
  assert.match(zone.source, /파일 선택/);
  const disabled = dropzone({ label: '포스터', disabled: true, onFiles: files => batches.push(files) });
  disabled.selected({ currentTarget: input });
  disabled.drop({ preventDefault() {}, dataTransfer: { files: [image()] } });
  assert.equal(batches.length, 1);
});
