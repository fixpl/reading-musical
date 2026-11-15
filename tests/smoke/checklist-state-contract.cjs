const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../backend/node_modules/typescript');

// 실제 화면의 비동기 함수를 실행해 조회·저장·확인의 순서가 바뀌어도 다른 공연의 입력을 건드리지 않는지 확인한다.
// Svelte effect와 DOM은 실행하지 않으며, 공연 전환은 테스트에서 pid와 epoch를 주입해 표현한다.
const component = fs.readFileSync(path.join(__dirname, '../../frontend/src/routes/app/p/[pid]/checklist/+page.svelte'), 'utf8');
const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const source = ts.createSourceFile('checklist.ts', script, ts.ScriptTarget.ES2022, true);
const names = ['load', 'act', 'add', 'saveEdit', 'remove', 'decide'];
const functions = names.map(name => {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `실제 checklist 함수 ${name}`);
  return declaration.getText(source);
}).join('\n');
const fields = ['pid', 'productionEpoch', 'loadVersion', 'data', 'loading', 'error', 'busyId', 'adding', 'editing', 'editLabel', 'editDescription', 'editDue', 'editApproval', 'editAssignees'];
const code = ts.transpileModule(`
  let pid = 'A', productionEpoch = 0, loadVersion = 0;
  let data = null, loading = true, error = '', busyId = null, adding = {}, editing = null;
  let editLabel = '', editDescription = '', editDue = '', editApproval = false, editAssignees = [];
  ${functions}
  return {
    ${names.join(', ')},
    state: () => ({ ${fields.join(', ')} }),
    patch: (next) => { ${fields.map(field => `if (Object.hasOwn(next, '${field}')) ${field} = next.${field};`).join('\n')} }
  };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const sessionCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/api/session.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const execute = new Function('apiRequest', 'peek', 'remember', 'toast', 'confirmation', 'captureSession', 'isCurrentSession', code);
const event = { preventDefault() {} };
const phase = { id: 'phase-A', phase: 'PLANNING' };
const item = (id = 'item-A') => ({ id, label: '기존 할 일', assignments: [] });
const workspace = (id, revision = 'fresh') => ({ production: { id, title: revision }, phases: [], memberships: [], myMembershipId: null, canEdit: true, totals: { items: 0, done: 0, waitingApproval: 0, blocked: 0, myAssigned: 0 } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function create({ request = async () => workspace('A'), ask = async () => ({ confirmed: false }), cached } = {}) {
  const calls = [], messages = [], writes = [], questions = [];
  // 함수 추출 실행기에도 실제 session 모듈을 주입한다. 기존 공연·초안 검증 조건은 유지한다.
  const sessionModule = { exports: {} };
  const token = `header.${Buffer.from(JSON.stringify({ sub: 'checklist-actor' })).toString('base64url')}.synthetic`;
  new Function('module', 'exports', 'localStorage', sessionCode)(sessionModule, sessionModule.exports, { getItem: () => token });
  const app = execute((url, init = {}) => {
    const call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return request(call);
  }, key => cached?.get(key), (key, value) => { writes.push({ key, value }); return value; }, {
    success: text => messages.push({ kind: 'success', text }),
    error: text => messages.push({ kind: 'error', text })
  }, { ask: options => { questions.push(options); return ask(options); } }, sessionModule.exports.captureSession, sessionModule.exports.isCurrentSession);
  return { ...app, calls, messages, writes, questions };
}

// 라우터가 새 공연을 렌더링한 뒤의 환경을 주입한다. 실제 load/act의 취소 판단은 모두 원본 함수가 한다.
function enter(app, pid, state = {}) {
  const before = app.state();
  app.patch({ pid, productionEpoch: before.productionEpoch + 1, loadVersion: before.loadVersion + 1, ...state });
}

test('cached content is shown immediately and fresh content is stored under the requested production', async () => {
  const response = deferred(), cached = workspace('A', 'cached'), fresh = workspace('A');
  const app = create({ cached: new Map([['checklist:A', cached]]), request: () => response.promise });
  const pending = app.load();
  assert.equal(app.state().data, cached);
  assert.equal(app.state().loading, false);
  assert.equal(app.calls[0].url, '/productions/A/checklist');
  response.resolve(fresh);
  await pending;
  assert.equal(app.state().data, fresh);
  assert.deepEqual(app.writes, [{ key: 'checklist:A', value: fresh }]);
});

for (const outcome of ['success', 'failure']) {
  test(`a late A lookup ${outcome} cannot overwrite B data, errors or loading state`, async () => {
    const response = deferred(), current = workspace('B');
    const app = create({ request: () => response.promise });
    const pending = app.load();
    enter(app, 'B', { data: current, error: 'B 조회 상태', loading: true });
    if (outcome === 'success') response.resolve(workspace('A')); else response.reject(new Error('A 연결 실패'));
    await pending;
    assert.equal(app.state().data, current);
    assert.equal(app.state().error, 'B 조회 상태');
    assert.equal(app.state().loading, true);
    assert.equal(app.writes.length, 0);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`reverse lookup order ignores an older ${outcome} after the latest result`, async () => {
    const old = deferred(), latest = deferred(), fresh = workspace('A', 'latest');
    let count = 0;
    const app = create({ request: () => (++count === 1 ? old.promise : latest.promise) });
    const first = app.load(), second = app.load();
    latest.resolve(fresh);
    await second;
    if (outcome === 'success') old.resolve(workspace('A', 'old')); else old.reject(new Error('오래된 조회 실패'));
    await first;
    assert.equal(app.state().data, fresh);
    assert.equal(app.state().error, '');
    assert.equal(app.state().loading, false);
    assert.equal(app.writes.length, 1);
  });
}

test('an A mutation finishing after A to B to A preserves the new editor and the initial assignment namespace', async () => {
  const patch = deferred(), target = item(), originalMembers = ['member-A'];
  const app = create({ request: call => call.method === 'PATCH' ? patch.promise : Promise.resolve({}) });
  app.patch({ editing: target, editLabel: 'A 저장 내용', editAssignees: originalMembers });
  const saving = app.saveEdit();
  assert.equal(app.calls.length, 1);
  originalMembers.push('later-member');
  enter(app, 'B');
  const newEditor = item('new-item-A');
  enter(app, 'A', { editing: newEditor, editLabel: '새 편집 내용', editAssignees: ['new-member-A'], busyId: 'new-request' });
  patch.resolve({});
  await saving;
  assert.deepEqual(app.calls.map(call => [call.method, call.url]), [
    ['PATCH', '/productions/A/checklist/items/item-A'],
    ['POST', '/productions/A/checklist/items/item-A/assignments']
  ]);
  assert.deepEqual(app.calls[1].body, { membershipIds: ['member-A'] });
  assert.equal(app.state().editing, newEditor);
  assert.equal(app.state().editLabel, '새 편집 내용');
  assert.equal(app.state().busyId, 'new-request');
  assert.equal(app.messages.length, 0);
});

test('a mutation waiting for its reload also becomes inactive after A to B to A', async () => {
  const response = deferred(), current = workspace('A', 'new entry');
  const app = create({ request: () => response.promise });
  const saving = app.act('old-item', async () => {}, '오래된 저장');
  await nextTurn();
  assert.equal(app.calls.length, 1);
  enter(app, 'B');
  enter(app, 'A', { data: current, busyId: 'new-item', loading: true });
  response.resolve(workspace('A', 'old reload'));
  assert.equal(await saving, false);
  assert.equal(app.state().data, current);
  assert.equal(app.state().busyId, 'new-item');
  assert.equal(app.state().loading, true);
  assert.equal(app.messages.length, 0);
});

test('a stale mutation error never reports failure or clears a newer production busy state', async () => {
  const response = deferred(), app = create();
  const saving = app.act('old-item', () => response.promise, '저장 완료');
  enter(app, 'B', { busyId: 'B-item' });
  response.reject(new Error('A 저장 실패'));
  assert.equal(await saving, false);
  assert.equal(app.state().busyId, 'B-item');
  assert.deepEqual(app.messages, []);
});

test('a failed add keeps its title and due date and does not reload', async () => {
  const draft = { label: '의상 확인', due: '2026-11-04' };
  const app = create({ request: async () => { throw new Error('추가 실패'); } });
  app.patch({ adding: { [phase.id]: draft } });
  await app.add(phase, event);
  assert.equal(app.state().adding[phase.id], draft);
  assert.equal(draft.label, '의상 확인');
  assert.equal(draft.due, '2026-11-04');
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].method, 'POST');
  assert.deepEqual(app.messages, [{ kind: 'error', text: '추가 실패' }]);
});

test('successful add clears only the submitted draft, never a newer draft typed while saving', async () => {
  for (const changed of [false, true]) {
    const response = deferred(), initial = { label: '처음 할 일', due: '' }, replacement = { label: '다음 할 일', due: '2026-11-05' };
    const app = create({ request: call => call.method === 'POST' ? response.promise : Promise.resolve(workspace('A')) });
    app.patch({ adding: { [phase.id]: initial } });
    const saving = app.add(phase, event);
    if (changed) app.patch({ adding: { [phase.id]: replacement } });
    response.resolve({});
    await saving;
    assert.equal(app.calls[0].body.label, '처음 할 일');
    if (changed) assert.equal(app.state().adding[phase.id], replacement);
    else assert.deepEqual(app.state().adding[phase.id], { label: '', due: '' });
  }
});

for (const failingMethod of ['PATCH', 'POST']) {
  test(`${failingMethod} failure keeps the edit dialog and all unsaved fields`, async () => {
    const target = item(), app = create({ request: async call => {
      if (call.method === failingMethod) throw new Error('저장 실패');
      return {};
    } });
    app.patch({ editing: target, editLabel: '바꾼 이름', editDescription: '유지할 설명', editDue: '2026-11-06', editApproval: true, editAssignees: ['member-A'] });
    await app.saveEdit();
    const state = app.state();
    assert.equal(state.editing, target);
    assert.equal(state.editLabel, '바꾼 이름');
    assert.equal(state.editDescription, '유지할 설명');
    assert.equal(state.editDue, '2026-11-06');
    assert.equal(state.editApproval, true);
    assert.deepEqual(state.editAssignees, ['member-A']);
    assert.equal(state.busyId, null);
    assert.equal(app.calls.some(call => call.method === 'GET'), false);
    assert.equal(app.calls.length, failingMethod === 'PATCH' ? 1 : 2);
  });
}

test('a successful save does not close a newly opened editor even when its item ID is reused', async () => {
  const response = deferred(), target = item(), reopened = item();
  const app = create({ request: call => call.method === 'PATCH' ? response.promise : Promise.resolve(workspace('A')) });
  app.patch({ editing: target, editLabel: '저장할 내용' });
  const saving = app.saveEdit();
  app.patch({ editing: reopened, editLabel: '새로 작성한 내용' });
  response.resolve({});
  await saving;
  assert.equal(app.state().editing, reopened);
  assert.equal(app.state().editLabel, '새로 작성한 내용');
  assert.ok(app.messages.some(message => message.kind === 'success'));
});

for (const operation of ['remove', 'decide']) {
  test(`${operation} cancellation or missing required reason sends no mutation`, async () => {
    for (const answer of [{ confirmed: false }, { confirmed: true, reason: '  ' }]) {
      const target = item(), app = create({ ask: async () => answer });
      app.patch({ editing: target, editLabel: '유지할 입력' });
      if (operation === 'remove') await app.remove(target); else await app.decide(target, 'REJECTED');
      assert.equal(app.calls.length, 0);
      assert.equal(app.questions.length, 1);
      assert.equal(app.state().editing, target);
      assert.equal(app.state().editLabel, '유지할 입력');
    }
  });

  test(`${operation} confirmation from a previous A entry cannot mutate after A to B to A`, async () => {
    const answer = deferred(), app = create({ ask: () => answer.promise });
    const target = item(), pending = operation === 'remove' ? app.remove(target) : app.decide(target, 'REJECTED');
    enter(app, 'B');
    const reopened = item('new-A');
    enter(app, 'A', { editing: reopened });
    answer.resolve({ confirmed: true, reason: '확인한 사유' });
    await pending;
    assert.equal(app.calls.length, 0);
    assert.equal(app.state().editing, reopened);
  });
}

test('delete failure preserves the editor while a successful delete closes the matching editor', async () => {
  for (const fails of [false, true]) {
    const target = item(), app = create({ ask: async () => ({ confirmed: true, reason: '중복 항목' }), request: async call => {
      if (call.method === 'DELETE' && fails) throw new Error('삭제 실패');
      return call.method === 'GET' ? workspace('A') : {};
    } });
    app.patch({ editing: target, editLabel: '작성 중인 내용' });
    await app.remove(target);
    assert.equal(app.calls[0].url, '/productions/A/checklist/items/item-A?force=true');
    assert.deepEqual(app.calls[0].body, { reason: '중복 항목' });
    assert.equal(app.state().editing, fails ? target : null);
    assert.equal(app.state().editLabel, '작성 중인 내용');
    assert.equal(app.calls.length, fails ? 1 : 2);
  }
});

test('a current lookup failure exposes an error and keeps already visible cached content', async () => {
  const cached = workspace('A', 'cached');
  const app = create({ cached: new Map([['checklist:A', cached]]), request: async () => { throw new Error('현재 조회 실패'); } });
  await app.load();
  assert.equal(app.state().data, cached);
  assert.equal(app.state().error, '현재 조회 실패');
  assert.equal(app.state().loading, false);
  assert.equal(app.writes.length, 0);
});

test('valid approval and rejection still call the current item API with the confirmed reason', async () => {
  for (const decision of ['APPROVED', 'REJECTED']) {
    const app = create({ ask: async () => ({ confirmed: true, reason: '  보완 후 재검토  ' }) });
    await app.decide(item(), decision);
    assert.deepEqual(app.calls.map(call => [call.method, call.url]), [
      ['POST', '/productions/A/checklist/items/item-A/approve'],
      ['GET', '/productions/A/checklist']
    ]);
    assert.deepEqual(app.calls[0].body, decision === 'REJECTED' ? { decision, reviewNote: '보완 후 재검토' } : { decision });
    assert.equal(app.questions.length, decision === 'REJECTED' ? 1 : 0);
    assert.equal(app.state().busyId, null);
    assert.equal(app.messages.filter(message => message.kind === 'success').length, 1);
  }
});
