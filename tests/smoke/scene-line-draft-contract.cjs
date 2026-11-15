const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../backend/node_modules/typescript');

// 실제 편집기의 load 함수를 실행해, 저장 후 재조회 중 초안과 그 조회 버전이 유지되는지 확인한다.
const component = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/components/app/scene-line-editor.svelte'), 'utf8');
const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const source = ts.createSourceFile('editor.ts', script, ts.ScriptTarget.ES2022, true);
const load = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'load');
const dirty = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'dirty'));
const hasSpeaker = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'hasSpeaker'));
assert.ok(load && dirty);
const compiled = ts.transpileModule(`
  let lines = initialLines, drafts = initialDrafts, roles = [], loading = false;
  let pid = 'show', scriptId = 'script', sceneId = 'scene';
  let loadVersion = 0, conflicts = {}, newText = '', deleteOpen = false, deleteTarget = null;
  ${hasSpeaker.getText(source)}
  ${dirty.getText(source)}
  ${load.getText(source)}
  return { load, switchScene: value => { sceneId = value; }, markConflict: id => { conflicts[id] = true; }, state: () => ({ lines, drafts, loading, conflicts }) };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const create = new Function('apiRequest', 'initialLines', 'initialDrafts', 'toast', compiled);
const line = (id, text, updatedAt = 'old-version') => ({ id, type: 'DIALOGUE', text, order: 1, updatedAt, character: null });
const draft = (text, expectedUpdatedAt = 'old-version') => ({ type: 'DIALOGUE', text, characterId: '', expectedUpdatedAt });
const response = blocks => ({ acts: [{ scenes: [{ id: 'scene', blocks }] }] });

test('saving one line retains the other dirty line and its original conflict token', async () => {
  const editor = create(async url => url.endsWith('/roles') ? [] : response([line('a', '저장됨', 'a-new'), line('b', '동료의 새 글', 'b-new')]),
    [line('a', '원본 A'), line('b', '원본 B')], { a: draft('저장됨'), b: draft('작성 중') }, { error: assert.fail });
  await editor.load(true, 'a');
  assert.equal(editor.state().drafts.a.expectedUpdatedAt, 'a-new');
  assert.equal(editor.state().drafts.b.text, '작성 중');
  assert.equal(editor.state().drafts.b.expectedUpdatedAt, 'old-version');
});
test('typing during a reorder reload is retained while an unchanged server line refreshes its conflict token', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const drafts = { a: draft('초안') };
  const editor = create(async url => url.endsWith('/roles') ? [] : pending, [line('a', '원본')], drafts, { error: assert.fail });
  const loading = editor.load(true);
  drafts.a.text = '재조회 중 계속 입력';
  resolve(response([line('a', '원본', 'server-new')]));
  await loading;
  assert.equal(editor.state().drafts.a.text, '재조회 중 계속 입력');
  assert.equal(editor.state().drafts.a.expectedUpdatedAt, 'server-new');
});
test('an actual content conflict keeps its original token across subsequent reorder reloads', async () => {
  const editor = create(async url => url.endsWith('/roles') ? [] : response([line('a', '다른 사용자의 수정', 'server-new')]),
    [line('a', '원본')], { a: draft('내 초안') }, { error: assert.fail });
  await editor.load(true);
  await editor.load(true);
  assert.equal(editor.state().drafts.a.text, '내 초안');
  assert.equal(editor.state().drafts.a.expectedUpdatedAt, 'old-version');
});
test('changing the speaker or line type keeps a dirty draft conflict token stale', async () => {
  for (const changed of [{ type: 'LYRIC' }, { character: { id: 'other', name: '다른 배역' } }]) {
    const editor = create(async url => url.endsWith('/roles') ? [] : response([{ ...line('a', '원본', 'server-new'), ...changed }]),
      [line('a', '원본')], { a: draft('내 초안') }, { error: assert.fail });
    await editor.load(true);
    assert.equal(editor.state().drafts.a.expectedUpdatedAt, 'old-version');
  }
});
test('explicit conflict reload replaces only the selected draft and clears its conflict marker', async () => {
  const editor = create(async url => url.endsWith('/roles') ? [] : response([line('a', '최신 원문', 'server-new'), line('b', '원본 B')]),
    [line('a', '원본 A'), line('b', '원본 B')], { a: draft('내 초안 A'), b: draft('내 초안 B') }, { error: assert.fail });
  editor.markConflict('a');
  await editor.load(true, 'a');
  assert.equal(editor.state().drafts.a.text, '최신 원문');
  assert.equal(editor.state().drafts.a.expectedUpdatedAt, 'server-new');
  assert.equal(editor.state().drafts.b.text, '내 초안 B');
  assert.equal(editor.state().conflicts.a, undefined);
});
test('a late response for the previous scene cannot overwrite the newly selected scene', async () => {
  let resolveOld;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  let reads = 0;
  const editor = create(async url => {
    if (url.endsWith('/roles')) return [];
    reads += 1;
    return reads === 1 ? oldResponse : { acts: [{ scenes: [{ id: 'other', blocks: [line('b', '새 장면')] }] }] };
  }, [], {}, { error: assert.fail });
  const first = editor.load();
  editor.switchScene('other');
  await editor.load();
  resolveOld(response([line('a', '이전 장면')]));
  await first;
  assert.equal(editor.state().lines[0].id, 'b');
  assert.equal(editor.state().drafts.b.text, '새 장면');
  assert.equal(editor.state().loading, false);
});
test('a failed reload keeps the existing draft and clears the loading state', async () => {
  let errors = 0;
  const editor = create(async () => { throw new Error('offline'); }, [line('a', '원본')], { a: draft('초안') }, { error: () => { errors += 1; } });
  await editor.load(true);
  assert.equal(editor.state().drafts.a.text, '초안');
  assert.equal(editor.state().loading, false);
  assert.equal(errors, 1);
});

// 실제 workspace의 이동 가드와 unsaved 식을 실행한다. 대사 편집 초안도 포함되어야 한다.
const workspaceScript = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/components/app/composition-workspace.svelte'), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const workspace = ts.createSourceFile('workspace.ts', workspaceScript, ts.ScriptTarget.ES2022, true);
const fn = name => workspace.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const unsavedNode = workspace.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(workspace) === 'unsaved');
const guardCode = ts.transpileModule(`
  let sectionDirty = false, mediaDirty = false, importDirty = false, attachmentDirty = false, registerDirty = false, videoDirty = false;
  let lineDirty = dirty, lineSaving = saving, busy = false, transferring = false, resetKey = 0;
  const unsaved = ${unsavedNode.initializer.arguments[0].getText(workspace)};
  ${fn('clearDraftFlags').getText(workspace)}
  ${fn('canLeaveDraft').getText(workspace)}
  const allowed = canLeaveDraft();
  return { allowed, lineDirty, resetKey };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const guard = new Function('dirty', 'saving', 'window', guardCode);
test('declining navigation keeps an unsaved line draft instead of silently resetting it', () => {
  let confirmations = 0;
  assert.deepEqual(guard(true, false, { confirm: () => { confirmations++; return false; } }), { allowed: false, lineDirty: true, resetKey: 0 });
  assert.equal(confirmations, 1);
  assert.deepEqual(guard(true, false, { confirm: () => true }), { allowed: true, lineDirty: false, resetKey: 1 });
});
test('navigation remains blocked while a line save is pending even after its draft is clean', () => {
  assert.deepEqual(guard(false, true, { confirm: assert.fail }), { allowed: false, lineDirty: false, resetKey: 0 });
});

// 등록 API 성공 뒤 구성 반영만 실패한 재시도는 같은 scriptId를 사용해야 한다.
const registerScript = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/components/app/script-register.svelte'), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const registerSource = ts.createSourceFile('register.ts', registerScript, ts.ScriptTarget.ES2022, true);
const registerFn = name => registerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const registerCode = ts.transpileModule(`
  let draft = { acts: [{ title: '1막', scenes: [{ title: '1장' }] }] }, busy = false, working = false;
  let applied = null, error = '', title = '대본', step = 'review', result = null;
  const pid = 'show';
  ${registerFn('register').getText(registerSource)}
  return { register, state: () => ({ applied, error, step, result, working }) };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const createRegister = new Function('apiRequest', 'onPreview', 'onCompose', 'pruned', registerCode);
test('retrying a failed composition reuses the applied script without another creation request', async () => {
  let applies = 0, compositions = 0;
  const previewIds = [];
  const register = createRegister(async () => { applies += 1; return { scriptId: 'saved-script', scenes: 1, newRoles: 2, cues: 3 }; },
    async ({ scriptId }) => { previewIds.push(scriptId); return { scriptId }; },
    async () => ++compositions === 2, value => value);
  await register.register();
  assert.equal(register.state().step, 'review');
  assert.equal(register.state().applied.scriptId, 'saved-script');
  await register.register();
  assert.equal(applies, 1);
  assert.deepEqual(previewIds, ['saved-script', 'saved-script']);
  assert.equal(register.state().step, 'done');
  assert.deepEqual(register.state().result, { scenes: 1, roles: 2, cues: 3 });
});
test('retrying a failed preview also reuses the script already saved by apply', async () => {
  let applies = 0, previews = 0;
  const register = createRegister(async () => { applies += 1; return { scriptId: 'saved-script', scenes: 1, newRoles: 0, cues: 0 }; },
    async () => { if (++previews === 1) throw new Error('offline'); return {}; }, async () => true, value => value);
  await register.register();
  await register.register();
  assert.equal(applies, 1);
  assert.equal(register.state().step, 'done');
});
test('destroying script registration immediately aborts analysis and releases both timers', () => {
  const onDestroy = registerSource.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(registerSource) === 'onDestroy');
  const cleanupCode = ts.transpileModule(`
    const controller = new AbortController();
    let timer = 17, limit = 23;
    ${registerFn('clearAnalysisTimers').getText(registerSource)}
    ${onDestroy.getText(registerSource)}
    return controller;
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let destroy;
  const intervals = [], timeouts = [];
  const controller = new Function('onDestroy', 'clearInterval', 'clearTimeout', cleanupCode)(
    callback => { destroy = callback; }, id => intervals.push(id), id => timeouts.push(id));
  destroy();
  destroy();
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(intervals, [17]);
  assert.deepEqual(timeouts, [23]);
});
