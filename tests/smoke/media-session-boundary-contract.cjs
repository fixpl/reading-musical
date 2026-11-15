/* 실제 helper와 Svelte handler를 실행하는 오프라인 회귀. 환경·서버·DB에 접근하지 않는다. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const token = (owner, serial = 1) => `header.${Buffer.from(JSON.stringify({ sub: owner, serial })).toString('base64url')}.signature`;
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const file = () => new File(['synthetic'], 'scene.png', { type: 'image/png' });
const input = value => ({ currentTarget: { files: [value], value: 'selected' } });
const apiDir = 'frontend/src/lib/api/';
const appDir = 'frontend/src/lib/components/app/';
const cuesheet = 'frontend/src/routes/app/p/[pid]/cuesheet/+page.svelte';
const showcase = 'frontend/src/lib/components/showcase/showcase-editor.svelte';

function setup(fetcher = async url => url.includes('/composition')
  ? json({ revision: 1, sections: [{ id: 'scene', title: '장면', media: [], timing: {} }] })
  : url.endsWith('/assets') ? json({ asset: { id: 'asset' }, upload: { url: 'https://upload.example.test/object', expiresAt: new Date(Date.now() + 60000).toISOString() } }) : json({})) {
  const values = new Map(), modules = new Map(), calls = [];
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const globals = { localStorage, Headers, Response, AbortController, DOMException, atob, FormData, ReadableStream, TextDecoder, URL, crypto: webcrypto, setTimeout, clearTimeout,
    document: { cookie: '' }, fetch: (url, init = {}) => { calls.push({ url, init }); return fetcher(url, init); } };
  function evaluate(source, extra = {}) {
    const module = { exports: {} }, scope = { ...globals, ...extra };
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('module', 'exports', 'require', ...Object.keys(scope), compiled)(module, module.exports, load, ...Object.values(scope));
    return module.exports;
  }
  function load(name) {
    if (name === '$env/dynamic/public') return { env: {} };
    const relative = name.startsWith('$lib/') ? `frontend/src/lib/${name.slice(5)}` : `${apiDir}${name.replace(/^\.\//, '')}`;
    if (modules.has(relative)) return modules.get(relative);
    const result = evaluate(fs.readFileSync(path.join(root, `${relative}.ts`), 'utf8'));
    modules.set(relative, result);
    return result;
  }
  const client = load('client'), session = load('session');
  function handlers(relative, names, bindings, states = []) {
    const full = fs.readFileSync(path.join(root, relative), 'utf8');
    const script = full.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
    const parsed = ts.createSourceFile(relative, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const functions = names.map(name => {
      const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
      assert.ok(declaration, `${relative}: ${name}`);
      return declaration.getText(parsed);
    }).join('\n');
    const source = `${functions}\nreturn { ${names.join(', ')}, read: () => ({ ${states.join(', ')} }) };`;
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const scope = { ...globals, ...session, apiRequest: client.apiRequest, uploadSignedObject: client.uploadSignedObject, ...bindings };
    return new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  }
  return { client, session, calls, load, handlers, setAccount: (owner, serial = 1) => client.saveTokens({ accessToken: token(owner, serial) }) };
}

const silentToast = { success() {}, error() {} };

test('미디어 예약·전송·장면 연결은 시작한 owner를 유지하고 같은 owner refresh는 허용한다', async () => {
  let app;
  app = setup(async url => {
    if (url.startsWith('https://upload.')) { app.setAccount('actor-a', 2); return json({}); }
    if (url.endsWith('/assets')) return json({ asset: { id: 'asset' }, upload: { url: 'https://upload.example.test/object' } });
    return json({ revision: 1, sections: [{ id: 'scene', title: '장면', media: [], timing: {} }] });
  });
  app.setAccount('actor-a');
  const session = app.session.captureSession(), media = app.load('composition-media');
  const uploaded = await media.uploadMediaFile('production', file(), session);
  assert.equal(await media.linkMedia('production', 'scene', uploaded.assetId, 'BACKGROUND', '영상', session), '장면');
  assert.equal(app.session.isCurrentSession(session), true);
  for (const call of app.calls.filter(call => !call.url.startsWith('https://upload.'))) {
    assert.match(new Headers(call.init.headers).get('authorization'), /^Bearer /);
  }
});

test('계정이 바뀐 뒤에는 이전 미디어 helper의 예약과 최종 연결 API를 시작하지 않는다', async () => {
  const app = setup(); app.setAccount('actor-a');
  const session = app.session.captureSession(), media = app.load('composition-media');
  app.setAccount('actor-b');
  await assert.rejects(media.uploadMediaFile('production', file(), session), { name: 'AbortError' });
  await assert.rejects(media.linkMedia('production', 'scene', 'asset', 'BACKGROUND', '영상', session), { name: 'AbortError' });
  assert.equal(app.calls.length, 0);
});

test('참고자료 ticket의 owner가 바뀌면 새 저장소 전송을 시작하지 않는다', async () => {
  const app = setup(); app.setAccount('actor-a');
  const references = app.load('reference-uploads');
  const ticket = await references.reserveReferenceUpload('production', file());
  assert.equal(ticket.session.owner, 'actor-a');
  const reserved = app.calls.length;
  app.setAccount('actor-b');
  await assert.rejects(references.transferReferenceFile(ticket, file()), { name: 'AbortError' });
  assert.equal(app.calls.length, reserved);
});

test('공연 포스터 저장 시 checksum 대기 중 계정 전환은 예약·업로드·초안 변경을 모두 막는다', async () => {
  const app = setup(), checksum = deferred(); app.setAccount('admin-a');
  const helper = app.load('showcase-image-upload'), selected = file();
  selected.arrayBuffer = () => checksum.promise;
  const image = helper.createPendingShowcaseImage(selected);
  const initial = { title: '공연', synopsis: '', description: '', venue: '', startDate: null, endDate: null,
    posterAssetId: image.id, officialUrl: '', ticketUrl: '', videoUrl: '', gallery: [] };
  const previews = { [image.id]: image.previewUrl };
  let saves = 0, adopts = 0;
  const handler = app.handlers(showcase, ['currentRequest', 'scopedSession', 'normalizedDraft', 'validDate', 'validationMessage', 'handleFailure', 'saveDraft'], {
    editor: { revision: 0 }, busy: '', uploadProgress: null, actionError: '', message: '', productionId: 'production', requestVersion: 1,
    disposed: false, viewSession: app.session.captureSession(), viewAbort: new AbortController(),
    draft: structuredClone(initial), pendingImages: { [image.id]: image }, mediaUrls: previews,
    uploadPendingShowcaseImages: helper.uploadPendingShowcaseImages,
    saveShowcaseDraft: async () => { saves += 1; }, adopt: () => { adopts += 1; }, toast: silentToast, ApiError: app.client.ApiError
  }, ['draft', 'mediaUrls', 'message']);
  try {
    const saving = handler.saveDraft();
    app.setAccount('admin-b'); checksum.resolve(new TextEncoder().encode('synthetic').buffer);
    await saving;
    assert.equal(app.calls.length, 0);
    assert.deepEqual(handler.read().draft, initial);
    assert.deepEqual(handler.read().mediaUrls, previews);
    assert.equal(handler.read().message, '');
    assert.equal(saves, 0);
    assert.equal(adopts, 0);
  } finally { helper.revokePendingShowcaseImage(image); }
});

test('여러 영상 중 첫 파일 대기 중 계정이 바뀌면 연결과 다음 파일을 중단한다', async () => {
  const app = setup(), upload = deferred(); app.setAccount('admin-a');
  let uploads = 0, links = 0, refreshes = 0;
  const handler = app.handlers(`${appDir}composition-video-batch.svelte`, ['linkAll'], {
    pid: 'production', viewSession: app.session.captureSession(), disposed: false, working: false, busy: false, error: '',
    queued: [1, 2].map(index => ({ file: file(), sectionId: `scene-${index}`, status: 'ready' })),
    uploadMediaFile: () => { uploads += 1; return upload.promise; }, slotForMime: () => 'BACKGROUND',
    linkMedia: async () => { links += 1; return '장면'; }, onDone: async () => { refreshes += 1; }, toast: silentToast
  });
  const linking = handler.linkAll();
  app.setAccount('admin-b'); upload.resolve({ assetId: 'asset', mime: 'image/png' });
  await linking;
  assert.equal(uploads, 1); assert.equal(links, 0); assert.equal(refreshes, 0);
});

test('batch의 AbortError는 같은 owner에서도 다음 파일로 넘기지 않는다', async () => {
  const app = setup(); app.setAccount('admin-a');
  let uploads = 0;
  const handler = app.handlers(`${appDir}composition-video-batch.svelte`, ['linkAll'], {
    pid: 'production', viewSession: app.session.captureSession(), disposed: false, working: false, busy: false, error: '',
    queued: [1, 2].map(index => ({ file: file(), sectionId: `scene-${index}`, status: 'ready' })),
    uploadMediaFile: async () => { uploads += 1; throw new DOMException('cancelled', 'AbortError'); },
    slotForMime: () => 'BACKGROUND', linkMedia: async () => '장면', onDone: async () => {}, toast: silentToast
  });
  await handler.linkAll(); assert.equal(uploads, 1);
});

test('같은 owner의 batch는 모든 파일을 연결하고 원래 session으로 완료를 알린다', async () => {
  const app = setup(); app.setAccount('admin-a');
  const session = app.session.captureSession(); let uploads = 0, links = 0, refreshed = null;
  const handler = app.handlers(`${appDir}composition-video-batch.svelte`, ['linkAll'], {
    pid: 'production', viewSession: session, disposed: false, working: false, busy: false, error: '',
    queued: [1, 2].map(index => ({ file: file(), sectionId: `scene-${index}`, status: 'ready' })),
    uploadMediaFile: async (_pid, _file, original) => { assert.equal(original, session); uploads += 1; app.setAccount('admin-a', 2); return { assetId: 'asset', mime: 'image/png' }; },
    slotForMime: () => 'BACKGROUND', linkMedia: async (...args) => { assert.equal(args[5], session); links += 1; return '장면'; },
    onDone: async original => { refreshed = original; }, toast: silentToast
  });
  await handler.linkAll(); assert.equal(uploads, 2); assert.equal(links, 2); assert.equal(refreshed, session);
});

test('영상 교체 대기 중 계정이 바뀌면 원래 공연에 연결하거나 완료 callback을 호출하지 않는다', async () => {
  const app = setup(), upload = deferred(); app.setAccount('admin-a');
  let links = 0, changes = 0;
  const handler = app.handlers(`${appDir}composition-media-detail.svelte`, ['replace'], {
    pid: 'production', owner: { id: 'scene' }, media: { slot: 'BACKGROUND' }, working: false, disposed: false,
    viewSession: app.session.captureSession(), uploadMediaFile: () => upload.promise,
    linkMedia: async () => { links += 1; }, onChanged: async () => { changes += 1; }, onClose() {}, toast: silentToast
  });
  const replacing = handler.replace(input(file()));
  app.setAccount('admin-b'); upload.resolve({ assetId: 'asset' });
  await replacing; assert.equal(links, 0); assert.equal(changes, 0);
});

test('참고자료 전송 대기 중 계정 전환은 최종 첨부와 다음 파일을 중단한다', async () => {
  const app = setup(), transfer = deferred(); app.setAccount('admin-a');
  const session = app.session.captureSession();
  let reservations = 0, attachments = 0;
  const handler = app.handlers(`${appDir}composition-attachments.svelte`, ['uploadAndAttach'], {
    pid: 'production', section: { id: 'scene' }, locked: false, canEdit: true, disposed: false, viewSession: session,
    transferring: false, dirty: true, error: '', queue: [1, 2].map(index => ({ file: file(), key: index })),
    reserveReferenceUpload: async () => { reservations += 1; return { session, upload: { expiresAt: new Date(Date.now() + 60000).toISOString() } }; },
    transferReferenceFile: () => transfer.promise, onAttach: async () => { attachments += 1; return true; }
  }, ['queue']);
  const attaching = handler.uploadAndAttach();
  await Promise.resolve();
  app.setAccount('admin-b'); transfer.resolve({ id: 'asset' });
  await attaching; assert.equal(reservations, 1); assert.equal(attachments, 0);
  assert.equal(handler.read().queue[0].asset, undefined);
});

test('참고자료 업로드·재사용 ticket·최종 첨부는 같은 owner session을 전달한다', async () => {
  const app = setup(); app.setAccount('admin-a');
  const session = app.session.captureSession(); let attachments = 0;
  const handler = app.handlers(`${appDir}composition-attachments.svelte`, ['uploadAndAttach'], {
    pid: 'production', section: { id: 'scene' }, locked: false, canEdit: true, disposed: false, viewSession: session,
    transferring: false, dirty: true, error: '', queue: [{ file: file(), key: 1 }],
    reserveReferenceUpload: async (_pid, _file, original) => { assert.equal(original, session); return { session, upload: { expiresAt: new Date(Date.now() + 60000).toISOString() } }; },
    transferReferenceFile: async (_ticket, _file, original) => { assert.equal(original, session); app.setAccount('admin-a', 2); return { id: 'asset' }; },
    onAttach: async (ids, original) => { assert.deepEqual(ids, ['asset']); assert.equal(original, session); attachments += 1; return true; }
  }, ['queue', 'dirty']);
  await handler.uploadAndAttach(); assert.equal(attachments, 1); assert.deepEqual(handler.read().queue, []); assert.equal(handler.read().dirty, false);
});

test('workspace의 native 확인창에서 계정이 바뀌면 이전 내용을 새 계정으로 쓰지 않는다', async () => {
  const app = setup(); app.setAccount('admin-a');
  const handler = app.handlers(`${appDir}composition-workspace.svelte`, ['canLeaveDraft', 'mutate'], {
    pid: 'production', base: '/productions/production/composition', viewSession: app.session.captureSession(), disposed: false,
    busy: false, saving: false, transferring: false, lineSaving: false, board: { canEdit: true, revision: 1 }, stale: false,
    unsaved: true, tab: 'section', error: '', toast: silentToast,
    window: { confirm: () => { app.setAccount('admin-b'); return true; } }, clearDraftFlags() {}, fetchBoard: async () => {}
  });
  assert.equal(await handler.mutate('/sections/scene/archive'), false);
  assert.equal(app.calls.length, 0);
});

function attachmentWorkspace(app, fetchBoard = async () => {}, overrides = {}) {
  return app.handlers(`${appDir}composition-workspace.svelte`, ['clearDraftFlags', 'mutate'], {
    pid: 'production', base: '/productions/production/composition', viewSession: app.session.captureSession(), disposed: false,
    busy: false, saving: false, transferring: true, board: { canEdit: true, revision: 1 }, stale: false,
    unsaved: true, tab: 'attachments', error: '', toast: silentToast, ApiError: app.client.ApiError,
    sectionDirty: false, mediaDirty: false, importDirty: false, attachmentDirty: true,
    registerDirty: false, videoDirty: false, lineDirty: false, resetKey: 0,
    canLeaveDraft() { throw new Error('첨부 저장은 전송 중 입력을 버리지 않는다'); }, fetchBoard, ...overrides
  }, ['busy', 'saving', 'transferring', 'attachmentDirty', 'resetKey', 'stale', 'error']);
}

test('참고자료 저장 후 자식 재생성·최신 구성 대기가 끝나면 부모 전송 잠금을 해제한다', async () => {
  const app = setup(), refreshing = deferred(), enteredRefresh = deferred(); app.setAccount('admin-a');
  const handler = attachmentWorkspace(app, async () => { enteredRefresh.resolve(); await refreshing.promise; });
  const saving = handler.mutate('/sections/scene/attachments', { assetIds: ['asset'] }, 'POST', 'scene', 'attachments');
  await enteredRefresh.promise;
  assert.equal(handler.read().resetKey, 1);
  assert.equal(handler.read().attachmentDirty, false);
  assert.equal(handler.read().transferring, true);
  assert.equal(handler.read().busy, true);
  app.setAccount('admin-a', 2);
  refreshing.resolve();
  assert.equal(await saving, true);
  assert.equal(handler.read().transferring, false);
  assert.equal(handler.read().busy, false);
  assert.equal(handler.read().saving, false);
});

test('참고자료 연결 실패는 재시도할 입력을 보존하고 부모 전송 잠금을 해제한다', async () => {
  const app = setup(async () => new Response(JSON.stringify({ message: '첨부 실패' }), { status: 500, headers: { 'content-type': 'application/json' } }));
  app.setAccount('admin-a');
  const handler = attachmentWorkspace(app);
  assert.equal(await handler.mutate('/sections/scene/attachments', { assetIds: ['asset'] }, 'POST', 'scene', 'attachments'), false);
  assert.equal(handler.read().resetKey, 0);
  assert.equal(handler.read().attachmentDirty, true);
  assert.equal(handler.read().transferring, false);
  assert.equal(handler.read().busy, false);
  assert.equal(handler.read().saving, false);
  assert.match(handler.read().error, /첨부 실패/);
});

test('첨부 저장 후 최신 구성 조회가 실패해도 전송 잠금을 풀고 stale 보호를 유지한다', async () => {
  const app = setup(); app.setAccount('admin-a');
  const handler = attachmentWorkspace(app, async () => { throw new Error('synthetic refresh failure'); });
  assert.equal(await handler.mutate('/sections/scene/attachments', { assetIds: ['asset'] }, 'POST', 'scene', 'attachments'), true);
  assert.equal(handler.read().resetKey, 1);
  assert.equal(handler.read().transferring, false);
  assert.equal(handler.read().busy, false);
  assert.equal(handler.read().saving, false);
  assert.equal(handler.read().stale, true);
  assert.match(handler.read().error, /최신 내용을 불러오지 못했어요/);
});

test('다른 계정으로 전환한 뒤 도착한 첨부 응답은 부모 상태와 잠금을 변경하지 않는다', async () => {
  const response = deferred(), app = setup(() => response.promise); app.setAccount('admin-a');
  let refreshes = 0;
  const handler = attachmentWorkspace(app, async () => { refreshes += 1; });
  const saving = handler.mutate('/sections/scene/attachments', { assetIds: ['asset'] }, 'POST', 'scene', 'attachments');
  app.setAccount('admin-b'); response.resolve(json({ revision: 2 }));
  assert.equal(await saving, false);
  assert.equal(refreshes, 0);
  assert.equal(handler.read().resetKey, 0);
  assert.equal(handler.read().attachmentDirty, true);
  assert.equal(handler.read().transferring, true);
  assert.equal(handler.read().busy, true);
  assert.equal(handler.read().saving, true);
  assert.equal(handler.read().error, '');
});

test('첨부 이외 workspace 저장은 진행 중인 전송 상태를 해제하지 않는다', async () => {
  const app = setup(); app.setAccount('admin-a');
  const handler = attachmentWorkspace(app, async () => {}, { unsaved: false });
  assert.equal(await handler.mutate('/sections/scene', {}, 'PATCH', 'scene', 'section'), true);
  assert.equal(handler.read().transferring, true);
  assert.equal(handler.read().busy, false);
  assert.equal(handler.read().saving, false);
});

test('대본 등록의 후속 workspace preview는 화면을 연 owner에 묶는다', async () => {
  const app = setup(); app.setAccount('admin-a');
  const handler = app.handlers(`${appDir}composition-workspace.svelte`, ['preview'], {
    base: '/productions/production/composition', viewSession: app.session.captureSession(), disposed: false
  });
  await handler.preview({ scriptId: 'first-script' });
  assert.equal(app.calls.length, 1);
  app.setAccount('admin-b');
  await assert.rejects(handler.preview({ scriptId: 'previous-owner-script' }), { name: 'AbortError' });
  assert.equal(app.calls.length, 1);
});

for (const [name, helper] of [['배경 영상', 'onPickBackground'], ['큐 미디어', 'onPickCueMedia']]) {
  test(`${name} 대기 중 계정 전환은 후속 API와 폼 연결을 중단한다`, async () => {
    const app = setup(), upload = deferred(); app.setAccount('admin-a');
    const handler = app.handlers(cuesheet, [helper], {
      pid: 'production', disposed: false, backgroundUploading: false, mediaUploading: false, mediaAssets: [], formAssetId: '',
      viewSession: app.session.captureSession(),
      uploadMediaFile: () => upload.promise, load: async () => {}, toast: silentToast
    }, ['mediaAssets', 'formAssetId']);
    const uploading = handler[helper](input(file()));
    app.setAccount('admin-b'); upload.resolve({ id: 'asset' });
    await uploading; assert.equal(app.calls.length, 0);
    assert.equal(handler.read().formAssetId, '');
  });
}
