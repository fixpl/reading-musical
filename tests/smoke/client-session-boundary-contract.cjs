const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const apiDir = path.join(root, 'frontend/src/lib/api');
const token = (owner, serial = 1) => `header.${Buffer.from(JSON.stringify({ sub: owner, serial })).toString('base64url')}.signature`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function setup(fetcher = async () => json({})) {
  const values = new Map(), modules = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  const events = (handlers) => ({ addEventListener: (name, callback) => handlers.set(name, callback), removeEventListener: (name) => handlers.delete(name) });
  const document = { cookie: '', ...events(documentEvents) }, window = events(windowEvents);
  const globals = { localStorage, document, window, Headers, Response, AbortController, DOMException, atob, FormData, ReadableStream, TextDecoder, URL, fetch: (...args) => fetcher(...args) };
  function evaluate(source, require, extra = {}) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const scope = { ...globals, ...extra };
    new Function('module', 'exports', 'require', ...Object.keys(scope), compiled)(module, module.exports, require, ...Object.values(scope));
    return module.exports;
  }
  function load(name) {
    if (name === '$env/dynamic/public') return { env: {} };
    const file = name.replace(/^\.\//, '');
    if (modules.has(file)) return modules.get(file);
    const result = evaluate(fs.readFileSync(path.join(apiDir, `${file}.ts`), 'utf8'), load);
    modules.set(file, result);
    return result;
  }
  const client = load('client'), session = load('session'), swr = load('swr');
  return { client, session, swr, load, evaluate, values, localStorage, windowEvents, documentEvents,
    setAccount: (owner, serial = 1) => client.saveTokens({ accessToken: token(owner, serial) }),
    externalAccount: (owner, serial = 1) => localStorage.setItem(session.ACCESS_TOKEN_KEY, token(owner, serial)) };
}

test('a rejected login is submitted once and leaves the existing session untouched', async () => {
  const calls = [];
  const app = setup(async (url, options) => {
    calls.push({ url, authorization: new Headers(options.headers).get('authorization') });
    if (url.endsWith('/auth/refresh')) return json({ tokens: { accessToken: token('actor-a', 2), refreshToken: 'synthetic' } });
    return json({ message: '이메일 또는 비밀번호를 확인해 주세요' }, 401);
  });
  app.setAccount('actor-a');
  await assert.rejects(app.client.apiRequest('/auth/login', { method: 'POST', body: '{}' }), { status: 401 });
  assert.deepEqual(calls, [{ url: '/api/v1/auth/login', authorization: null }]);
  assert.equal(app.client.getAccessToken(), token('actor-a'));
});

test('late refresh cannot restore the previous account or retry its request after account switch', async () => {
  const started = deferred(), refresh = deferred();
  let privateCalls = 0;
  const app = setup(async (url) => {
    if (url.endsWith('/auth/refresh')) { started.resolve(); return refresh.promise; }
    privateCalls += 1;
    return json({}, 401);
  });
  app.setAccount('actor-a');
  const request = app.client.apiRequest('/private');
  const rejection = assert.rejects(request, { name: 'AbortError' });
  await started.promise;
  app.setAccount('actor-b');
  refresh.resolve(json({ tokens: { accessToken: token('actor-a', 2), refreshToken: 'synthetic' } }));
  await rejection;
  assert.equal(app.client.getAccessToken(), token('actor-b'));
  assert.equal(privateCalls, 1);
});

test('late refresh failure cannot clear a newer login and logout cannot revoke the new local account', async () => {
  const started = deferred(), refresh = deferred(), logout = deferred();
  const app = setup(async (url) => {
    if (url.endsWith('/auth/refresh')) { started.resolve(); return refresh.promise; }
    if (url.endsWith('/auth/logout')) return logout.promise;
    return json({}, 401);
  });
  app.setAccount('actor-a');
  const request = app.client.apiRequest('/private');
  const rejection = assert.rejects(request, { name: 'AbortError' });
  await started.promise;
  const loggingOut = app.load('auth').logout();
  app.setAccount('actor-b');
  refresh.resolve(json({}, 401));
  logout.resolve(json({}));
  await rejection;
  assert.equal(await loggingOut, false);
  assert.equal(app.client.getAccessToken(), token('actor-b'));
});

test('late JSON bodies are rejected and a loaded session cannot start a write under another account', async () => {
  const body = deferred(), started = deferred();
  let writes = 0;
  const app = setup(async (_url, init) => {
    if (init.method === 'PUT') { writes += 1; return json({}); }
    started.resolve();
    return { status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => body.promise };
  });
  app.setAccount('actor-a');
  const original = app.session.captureSession();
  const request = app.client.apiRequest('/private');
  const rejection = assert.rejects(request, { name: 'AbortError' });
  await started.promise;
  app.setAccount('actor-b');
  body.resolve({ note: 'synthetic-private-note' });
  await rejection;
  await assert.rejects(app.client.apiRequest('/rehearsal/me', { method: 'PUT', session: original, body: '{}' }), { name: 'AbortError' });
  assert.equal(writes, 0);
});

test('parallel 401 requests share one refresh while a same-owner refresh preserves the owner epoch', async () => {
  const refresh = deferred(), started = deferred();
  let refreshes = 0;
  const app = setup(async (url, init) => {
    if (url.endsWith('/auth/refresh')) { refreshes += 1; started.resolve(); return refresh.promise; }
    return json({ ok: true }, new Headers(init.headers).get('authorization') === `Bearer ${token('actor-a', 2)}` ? 200 : 401);
  });
  app.setAccount('actor-a');
  const before = app.session.captureSession();
  const first = app.client.apiRequest('/one'), second = app.client.apiRequest('/two');
  await started.promise;
  refresh.resolve(json({ tokens: { accessToken: token('actor-a', 2), refreshToken: 'synthetic' } }));
  await Promise.all([first, second]);
  assert.equal(refreshes, 1);
  assert.equal(app.session.isCurrentSession(before), true);
  assert.equal(app.session.isCurrentSession(before, true), false);
  assert.equal(before.signal.aborted, false);
});

test('a stale HttpOnly refresh cookie cannot replace the current owner with another account', async () => {
  let privateCalls = 0;
  const app = setup(async (url) => {
    if (url.endsWith('/auth/refresh')) return json({ tokens: { accessToken: token('actor-a', 2), refreshToken: 'synthetic' } });
    privateCalls += 1;
    return json({}, 401);
  });
  app.setAccount('actor-b');
  await assert.rejects(app.client.apiRequest('/private'), { name: 'AbortError' });
  assert.equal(app.client.getAccessToken(), null);
  assert.equal(privateCalls, 1);
});

test('owner-scoped cache rejects stale reinsertion after logout, including an A to B to A cycle', () => {
  const app = setup();
  app.setAccount('admin-a');
  const original = app.session.captureSession();
  app.swr.remember('admin:members', { items: ['synthetic'] }, original);
  assert.equal(app.swr.peek('admin:members').items.length, 1);
  app.client.clearTokens();
  assert.equal(app.swr.peek('admin:members'), undefined);
  app.setAccount('actor-b');
  app.setAccount('admin-a');
  assert.throws(() => app.swr.remember('admin:members', { items: ['stale'] }, original), { name: 'AbortError' });
  assert.equal(app.swr.peek('admin:members'), undefined);
});

test('cross-tab storage and focus changes invalidate once, same-owner rotations preserve the view, cleanup removes listeners', () => {
  const app = setup();
  app.setAccount('actor-a');
  let resets = 0;
  const unsubscribe = app.session.subscribeSession(() => { resets += 1; });
  const stop = app.session.watchSession();
  app.externalAccount('actor-a', 2);
  app.windowEvents.get('storage')({ key: app.session.ACCESS_TOKEN_KEY });
  assert.equal(resets, 0);
  app.externalAccount('actor-b');
  app.windowEvents.get('focus')();
  app.windowEvents.get('storage')({ key: app.session.ACCESS_TOKEN_KEY });
  assert.equal(resets, 1);
  app.localStorage.removeItem(app.session.ACCESS_TOKEN_KEY);
  app.documentEvents.get('visibilitychange')();
  assert.equal(resets, 2);
  stop(); unsubscribe();
  assert.equal(app.windowEvents.size + app.documentEvents.size, 0);
});

test('multipart uploads and NDJSON do not deliver previous-account payloads after a switch', async () => {
  const upload = deferred(), streamed = deferred();
  const app = setup(async (url) => url.endsWith('/upload') ? upload.promise : streamed.promise);
  app.setAccount('actor-a');
  const form = app.client.uploadForm('/upload', new FormData());
  const events = [];
  const stream = app.client.streamNdjson('/stream', {}, (event) => events.push(event));
  const rejectedForm = assert.rejects(form, { name: 'AbortError' }), rejectedStream = assert.rejects(stream, { name: 'AbortError' });
  app.setAccount('actor-b');
  upload.resolve(json({ private: true }));
  streamed.resolve(json({ type: 'synthetic' }));
  await Promise.all([rejectedForm, rejectedStream]);
  assert.deepEqual(events, []);
});

test('signed uploads reject a previous-account completion before the caller can attach its asset', async () => {
  const upload = deferred();
  const app = setup(() => upload.promise);
  app.setAccount('actor-a');
  const request = app.client.uploadSignedObject({ url: 'https://storage.invalid/synthetic' }, 'synthetic');
  const rejection = assert.rejects(request, { name: 'AbortError' });
  app.setAccount('actor-b');
  upload.resolve(new Response('', { status: 200 }));
  await rejection;
});

test('a stream cannot deliver another buffered event after its callback changes the owner', async () => {
  const app = setup(async () => new Response('{"type":"first"}\n{"type":"second"}\n', { status: 200 }));
  app.setAccount('actor-a');
  const events = [];
  await assert.rejects(app.client.streamNdjson('/stream', {}, (event) => { events.push(event.type); app.setAccount('actor-b'); }), { name: 'AbortError' });
  assert.deepEqual(events, ['first']);
});

function rehearsal(app) {
  const source = fs.readFileSync(path.join(root, 'frontend/src/lib/components/app/rehearsal-record.svelte'), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const effects = [];
  const props = { pid: 'synthetic-production', source: 'composition', positionMs: 0, unitKey: 'overview', unitTitle: '전체 공연', onresume: () => {} };
  const state = Object.assign((value) => value, { raw: (value) => value });
  const harness = `\nmodule.exports.harness = { reload, save, start: () => effects[1](), setSource: value => { source = value; }, setNote: () => { notes = { overview: 'synthetic-private-note' }; dirty = true; }, get: () => ({ dirty, savedAt, saving, record, notes }) };`;
  const prefix = 'const $state = state; const $derived = value => value; const $props = () => props; const $effect = callback => effects.push(callback);\n';
  return app.evaluate(prefix + source + harness, (name) => {
    if (name === 'svelte') return { untrack: (callback) => callback() };
    if (name === '$app/navigation') return { beforeNavigate: () => {} };
    if (name === '$lib/api/client') return app.client;
    if (name === '$lib/api/session') return app.session;
    if (name === '$lib/domain/performance-timeline') return { formatTimelineTime: String };
    throw new Error(`Unexpected rehearsal import: ${name}`);
  }, { state, props, effects }).harness;
}

test('personal rehearsal notes keep overview keys and refuse a save from a previously loaded account', async () => {
  let writes = 0;
  const app = setup(async (_url, init) => {
    if (init.method === 'PUT') { writes += 1; return json({}); }
    return json([]);
  });
  app.setAccount('actor-a');
  const view = rehearsal(app);
  await view.reload(); view.setNote();
  app.setAccount('actor-b');
  await view.save();
  assert.equal(writes, 0);
});

test('same-owner refresh keeps a rehearsal draft and saves the original source and overview key', async () => {
  let saved;
  const app = setup(async (_url, init) => {
    if (init.method === 'PUT') { saved = JSON.parse(init.body); return json({ ...saved, revision: 1 }); }
    return json([]);
  });
  app.setAccount('actor-a');
  const view = rehearsal(app);
  await view.reload(); view.setNote();
  app.setAccount('actor-a', 2);
  await view.save();
  assert.equal(saved.source, 'composition');
  assert.deepEqual(Object.keys(saved.notes), ['overview']);
  assert.equal(view.get().dirty, false);
});

test('a disposed rehearsal view ignores the completion and finally block of an earlier save', async () => {
  const save = deferred();
  const app = setup(async (_url, init) => init.method === 'PUT' ? save.promise : json([]));
  app.setAccount('actor-a');
  const view = rehearsal(app);
  const dispose = view.start();
  await view.reload(); view.setNote();
  const saving = view.save();
  dispose();
  app.setAccount('actor-b');
  save.resolve(json({ source: 'composition', positionMs: 0, completedKeys: [], notes: { overview: 'synthetic' }, revision: 1 }));
  await saving;
  assert.equal(view.get().dirty, true);
  assert.equal(view.get().savedAt, '');
});

test('switching rehearsal sources while a save waits releases the new source form', async () => {
  const save = deferred();
  const app = setup(async (_url, init) => init.method === 'PUT' ? save.promise : json([]));
  app.setAccount('actor-a');
  const view = rehearsal(app);
  const dispose = view.start();
  await view.reload(); view.setNote();
  const saving = view.save();
  assert.equal(view.get().saving, true);
  dispose(); view.setSource('script-b'); view.start();
  await view.reload();
  assert.equal(view.get().saving, false);
  save.resolve(json({ source: 'composition', positionMs: 0, completedKeys: [], notes: {}, revision: 1 }));
  await saving;
  assert.equal(view.get().record.source, 'script-b');
  assert.equal(view.get().saving, false);
});

function profile(app, checksum = async () => 'synthetic-checksum') {
  const source = fs.readFileSync(path.join(root, 'frontend/src/routes/app/profile/+page.svelte'), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const destroy = [], notifications = [];
  const state = Object.assign((value) => value, { raw: (value) => value });
  // 이 harness는 비동기 세션 경계를 실행한다. DOM 없는 Rune stub에서는 유효한 암호 입력의 검증 결과를 주입한다.
  const derived = Object.assign((value) => typeof value === 'boolean' ? true : value, { by: (callback) => callback() });
  const prefix = 'const $state = state; const $derived = derived; const $effect = () => {}; const $page = { data: { site: { policies: [{ id: "synthetic-policy", kind: "PROFILE_PRIVACY" }] } } };\n';
  const harness = `\nmodule.exports.harness = { loadProfile, save, changePassword, dispose: () => destroy.forEach(callback => callback()), setDraft: withPhoto => { name = 'synthetic-private-name'; phone = 'synthetic-private-phone'; profilePrivacyConsent = true; if (withPhoto) photoFile = { name: 'synthetic.png', type: 'image/png', size: 3 }; }, setPassword: () => { currentPassword = 'synthetic-old'; newPassword = confirmPassword = 'synthetic-A1234'; }, get: () => ({ saveError, saveMessage, passwordError, passwordMessage, saving }), notifications };`;
  return app.evaluate(prefix + source + harness, (name) => {
    if (name === 'svelte') return { onMount: () => {}, onDestroy: (callback) => destroy.push(callback) };
    if (name === '$lib/api/client') return app.client;
    if (name === '$lib/api/session') return app.session;
    if (name === '$lib/api/checksum') return { fileSha256Checksum: checksum };
    if (name === '$lib/api/auth') return app.load('auth');
    if (name === '$app/navigation') return { invalidate: async () => {} };
    if (name === 'svelte-sonner') return { toast: { success: () => notifications.push('success'), error: () => notifications.push('error') } };
    throw new Error(`Unexpected profile import: ${name}`);
  }, { state, derived, destroy, notifications }).harness;
}

test('profile checksum completion cannot reserve or attach the old account photo to the new account', async () => {
  const checksum = deferred(), started = deferred();
  let reservations = 0, patches = 0;
  const app = setup(async (url, init) => {
    if (init.method === 'POST') reservations += 1;
    if (init.method === 'PATCH') patches += 1;
    return json({ id: 'actor-a', email: 'synthetic@invalid.test', name: 'synthetic', phone: null, profileType: 'ACTOR', profileComplete: true });
  });
  app.setAccount('actor-a');
  const view = profile(app, () => { started.resolve(); return checksum.promise; });
  await view.loadProfile(); view.setDraft(true);
  const saving = view.save({ preventDefault() {} });
  await started.promise;
  view.dispose(); app.setAccount('actor-b');
  checksum.resolve('synthetic-checksum');
  await saving;
  assert.equal(reservations, 0);
  assert.equal(patches, 0);
  assert.deepEqual(view.notifications, []);
});

test('a no-photo profile continuation and password completion cannot use the next account', async () => {
  let patches = 0;
  const password = deferred();
  const app = setup(async (url, init) => {
    if (url.endsWith('/auth/password/change')) return password.promise;
    if (init.method === 'PATCH') patches += 1;
    return json({ id: 'actor-a', email: 'synthetic@invalid.test', name: 'synthetic', profileType: 'ACTOR' });
  });
  app.setAccount('actor-a');
  const view = profile(app);
  await view.loadProfile(); view.setDraft(false); view.setPassword();
  const saving = view.save({ preventDefault() {} });
  const changing = view.changePassword({ preventDefault() {} });
  view.dispose(); app.setAccount('actor-b');
  password.resolve(json({ tokens: { accessToken: token('actor-a', 2), refreshToken: 'synthetic' } }));
  await Promise.all([saving, changing]);
  assert.equal(patches, 0);
  assert.equal(app.client.getAccessToken(), token('actor-b'));
  assert.deepEqual(view.notifications, []);
});

test('the current profile can reserve its photo and attach it without changing account ownership', async () => {
  let saved;
  const person = { id: 'actor-a', email: 'synthetic@invalid.test', name: 'synthetic', profileType: 'ACTOR' };
  const app = setup(async (url, init) => {
    if (url.endsWith('/assets')) return json({ asset: { id: 'synthetic-photo' }, upload: { url: 'https://storage.invalid/synthetic' } });
    if (url.startsWith('https://storage.invalid/')) return new Response('', { status: 200 });
    if (init.method === 'PATCH') { saved = JSON.parse(init.body); return json({ ...person, ...saved }); }
    return json(person);
  });
  app.setAccount('actor-a');
  const view = profile(app);
  await view.loadProfile(); view.setDraft(true);
  await view.save({ preventDefault() {} });
  assert.equal(saved.photoAssetId, 'synthetic-photo');
  assert.equal(saved.name, 'synthetic-private-name');
  assert.equal(app.client.getAccessToken(), token('actor-a'));
  assert.deepEqual(view.notifications, ['success']);
});

test('password change accepts its own new token after the request refreshed the same account', async () => {
  const app = setup(async (url, init) => {
    if (url.endsWith('/auth/refresh')) return json({ tokens: { accessToken: token('actor-a', 2), refreshToken: 'synthetic' } });
    if (url.endsWith('/auth/password/change')) {
      return new Headers(init.headers).get('authorization') === `Bearer ${token('actor-a', 2)}`
        ? json({ tokens: { accessToken: token('actor-a', 3), refreshToken: 'synthetic' } }) : json({}, 401);
    }
    return json({ id: 'actor-a', email: 'synthetic@invalid.test', name: 'synthetic', profileType: 'ACTOR' });
  });
  app.setAccount('actor-a');
  const view = profile(app);
  await view.loadProfile(); view.setPassword();
  await view.changePassword({ preventDefault() {} });
  assert.equal(app.client.getAccessToken(), token('actor-a', 3));
  assert.deepEqual(view.notifications, ['success']);
});

test('guest inquiry POST remains anonymous for a logged-in member and preserves its own 401 error', async () => {
  const requests = [];
  const app = setup(async (url, init) => {
    requests.push({ url, init });
    return requests.length === 1 ? json({ ok: true }) : json({ message: 'synthetic lookup denied' }, 401);
  });
  app.setAccount('actor-a');
  const inquiry = app.load('inquiries');
  assert.deepEqual(await inquiry.inquiryLookup('detail', { accessToken: 'synthetic-scoped-token' }), { ok: true });
  await assert.rejects(inquiry.inquiryLookup('detail', { accessToken: 'synthetic-scoped-token' }), (error) => {
    assert.equal(error instanceof inquiry.InquiryLookupError, true);
    assert.equal(error.status, 401);
    assert.equal(error.message, 'synthetic lookup denied');
    return true;
  });
  assert.equal(requests.length, 2);
  for (const { url, init } of requests) {
    assert.equal(url, '/api/v1/inquiries/lookup/detail');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
    assert.equal(JSON.parse(init.body).accessToken, 'synthetic-scoped-token');
    assert.equal(init.signal instanceof AbortSignal, true);
  }
  assert.equal(app.client.getAccessToken(), token('actor-a'));
});

test('guest inquiry keeps its fallback message and status for a non-JSON failure', async () => {
  const app = setup(async () => new Response('invalid-json', { status: 503 }));
  const inquiry = app.load('inquiries');
  await assert.rejects(inquiry.inquiryLookup('detail', {}), (error) => {
    assert.equal(error instanceof inquiry.InquiryLookupError, true);
    assert.equal(error.status, 503);
    assert.equal(error.message, '요청을 처리하지 못했어요. 다시 시도해 주세요.');
    return true;
  });
});
