const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../backend/node_modules/typescript');

// 실제 게스트 화면의 REST·socket 수명 함수를 실행해 접근 종료 뒤 내용이 되살아나지 않는지 확인한다.
const component = fs.readFileSync(path.join(__dirname, '../../frontend/src/routes/(legacy)/r/[token]/+page.svelte'), 'utf8');
const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const source = ts.createSourceFile('guest-reading.ts', script, ts.ScriptTarget.ES2022, true);
const names = ['connectReadingSocket', 'isCurrentSocket', 'disconnectReadingSocket', 'endGuestAccess', 'handleRealtimeReadingEvent', 'loadWorkspace', 'alignSelectedItem'];
const functions = names.map(name => {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(source);
}).join('\n');
const mount = source.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'onMount');
assert.ok(mount);
const compiled = ts.transpileModule(`
  const token = 'guest-token';
  let workspace = initialWorkspace, loading = false, errorMessage = '', selectedItemId = 'private-item', followCurrent = false;
  let realtimeStatus = 'idle', realtimeMessage = '', realtimeSocket = null, realtimeSocketKey = '', realtimeReloading = false;
  let accessEnded = false, workspaceEpoch = 0, disposed = false;
  ${functions}
  ${mount.getText(source)}
  return { connectReadingSocket, loadWorkspace, state: () => ({ workspace, loading, errorMessage, selectedItemId, followCurrent, realtimeStatus, realtimeMessage, accessEnded }) };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const create = new Function('apiRequest', 'ApiError', 'initialWorkspace', 'onMount', 'window', 'getWsBaseUrl', 'require', compiled);
class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const workspace = () => ({
  production: { id: 'show', title: '비공개 공연' },
  event: { id: 'event' },
  activeSession: { id: 'session', currentSceneId: 'scene', cueFireLogs: [] },
  preferredRunSheet: { items: [{ id: 'private-item', sceneId: 'scene' }] },
  runSheets: [], scenes: [{ id: 'scene', title: '비공개 장면' }], cueFireLogs: []
});

function setup(request = async () => workspace()) {
  const handlers = new Map();
  let onMount, disconnects = 0, connects = 0, requests = 0;
  const socket = {
    on(event, handler) { handlers.set(event, handler); return socket; },
    disconnect() { disconnects += 1; handlers.get('disconnect')?.(); }
  };
  const page = create(async (...args) => { requests += 1; return request(...args); }, ApiError, workspace(),
    callback => { onMount = callback; }, { setInterval: () => 1, clearInterval: () => {} }, () => 'http://local/ws',
    name => { assert.equal(name, 'socket.io-client'); return { io: () => { connects += 1; return socket; } }; });
  return { ...page, handlers, mount: () => onMount(), disconnects: () => disconnects, connects: () => connects, requests: () => requests };
}

test('terminal guest socket notification immediately removes all protected workspace and disconnects', async () => {
  const page = setup();
  await page.connectReadingSocket();
  page.handlers.get('notification.error')({ message: '게스트 링크가 회수됐어요.' });
  assert.equal(page.state().workspace, null);
  assert.equal(page.state().selectedItemId, '');
  assert.equal(page.state().followCurrent, true);
  assert.equal(page.state().errorMessage, '게스트 링크가 회수됐어요.');
  assert.equal(page.state().realtimeStatus, 'error');
  assert.equal(page.disconnects(), 1);
  page.handlers.get('reading-session.connected')({ room: 'old-room' });
  page.handlers.get('connect_error')(new Error('late connection error'));
  page.handlers.get('reading-session.event')({ eventId: 'event' });
  await page.connectReadingSocket();
  assert.equal(page.state().realtimeStatus, 'error');
  assert.equal(page.state().workspace, null);
  assert.equal(page.connects(), 1);
  assert.equal(page.requests(), 0);
});

test('temporary socket connection errors and ordinary disconnect keep REST fallback content', async () => {
  const page = setup();
  await page.connectReadingSocket();
  page.handlers.get('connect_error')(new Error('network unavailable'));
  assert.equal(page.state().realtimeStatus, 'fallback');
  assert.equal(page.state().workspace.production.title, '비공개 공연');
  page.handlers.get('reading-session.connected')({ room: 'guest-room' });
  page.handlers.get('disconnect')();
  assert.equal(page.state().realtimeStatus, 'fallback');
  assert.equal(page.state().accessEnded, false);
  assert.equal(page.disconnects(), 0);
  await page.loadWorkspace(true);
  assert.equal(page.state().workspace.scenes[0].title, '비공개 장면');
});

for (const status of [401, 403, 404, 410]) {
  test(`silent REST ${status} clears protected workspace and terminates the socket`, async () => {
    const page = setup(async () => { throw new ApiError('접근이 끝났어요.', status); });
    await page.connectReadingSocket();
    await page.loadWorkspace(true);
    assert.equal(page.state().workspace, null);
    assert.equal(page.state().selectedItemId, '');
    assert.equal(page.state().loading, false);
    assert.equal(page.state().accessEnded, true);
    assert.equal(page.disconnects(), 1);
  });
}

test('silent REST 503 preserves fallback content and a later successful reload clears the error', async () => {
  let attempt = 0;
  const page = setup(async () => { if (++attempt === 1) throw new ApiError('잠시 후 다시 시도해 주세요.', 503); return workspace(); });
  await page.loadWorkspace(true);
  assert.equal(page.state().workspace.production.id, 'show');
  assert.equal(page.state().accessEnded, false);
  assert.equal(page.state().errorMessage, '잠시 후 다시 시도해 주세요.');
  await page.loadWorkspace(true);
  assert.equal(page.state().errorMessage, '');
  assert.equal(page.state().workspace.production.id, 'show');
});

test('a REST success already in flight cannot resurrect content after terminal socket notification', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const page = setup(() => pending);
  await page.connectReadingSocket();
  const loading = page.loadWorkspace(true);
  page.handlers.get('notification.error')({ message: '공연이 삭제됐어요.' });
  resolve(workspace());
  await loading;
  await page.loadWorkspace();
  assert.equal(page.state().workspace, null);
  assert.equal(page.state().selectedItemId, '');
  assert.equal(page.state().errorMessage, '공연이 삭제됐어요.');
  assert.equal(page.requests(), 1);
});

test('a late REST error cannot replace the terminal access message', async () => {
  let reject;
  const pending = new Promise((resolve, fail) => { reject = fail; });
  const page = setup(() => pending);
  await page.connectReadingSocket();
  const loading = page.loadWorkspace(true);
  page.handlers.get('notification.error')({ message: '링크가 만료됐어요.' });
  reject(new ApiError('서비스에 연결하지 못했어요.', 503));
  await loading;
  assert.equal(page.state().workspace, null);
  assert.equal(page.state().errorMessage, '링크가 만료됐어요.');
});

test('unmount invalidates pending REST success and socket module setup', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const page = setup(() => pending);
  const initial = page.state().workspace;
  const stop = page.mount();
  stop();
  resolve({ ...workspace(), production: { id: 'late', title: '늦은 응답' } });
  await pending;
  await new Promise(done => setImmediate(done));
  assert.equal(page.state().workspace, initial);
  assert.equal(page.connects(), 0);
  assert.equal(page.requests(), 1);
});
