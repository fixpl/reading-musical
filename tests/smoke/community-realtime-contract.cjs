const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'frontend/src/lib/api/community.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function setup() {
  const handlers = new Map(), timeouts = new Map(), intervals = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const changes = [], connections = [];
  let nextTimer = 0, token = 'first-session', disconnected = false, connects = 0;
  const socket = {
    connected: true,
    on: (event, callback) => handlers.set(event, callback),
    connect: () => { connects++; },
    disconnect: () => { disconnected = true; }
  };
  let options;
  const module = { exports: {} };
  const document = { hidden: false, addEventListener: (event, callback) => documentEvents.set(event, callback), removeEventListener: (event) => documentEvents.delete(event) };
  const window = { addEventListener: (event, callback) => windowEvents.set(event, callback), removeEventListener: (event) => windowEvents.delete(event) };
  new Function('module', 'exports', 'require', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'window', 'document', compiled)(
    module, module.exports, (name) => {
      if (name === 'socket.io-client') return { io: (url, input) => { assert.equal(url, 'http://local/ws'); options = input; return socket; } };
      assert.equal(name, './client');
      return { getWsBaseUrl: () => 'http://local/ws', getAccessToken: () => token };
    },
    (callback) => { const id = ++nextTimer; timeouts.set(id, callback); return id; }, (id) => timeouts.delete(id),
    (callback) => { const id = ++nextTimer; intervals.set(id, callback); return id; }, (id) => intervals.delete(id), window, document
  );
  const stop = module.exports.watchCommunity('our-show', (id) => changes.push(id), (value) => connections.push(value));
  const flush = () => { const callbacks = [...timeouts.values()]; timeouts.clear(); callbacks.forEach((callback) => callback()); };
  const emit = (postId, productionId = 'our-show') => handlers.get('board.changed')({ productionId, postId });
  return { stop, flush, emit, changes, connections, handlers, options, socket, timeouts, intervals, windowEvents, documentEvents, document,
    setToken: (value) => { token = value; }, isDisconnected: () => disconnected, connectCount: () => connects };
}

test('different topics in one realtime burst invalidate all open topics', () => {
  const client = setup();
  client.emit('topic-a'); client.emit('topic-b'); client.emit('topic-b'); client.flush();
  assert.deepEqual(client.changes, [undefined]);
  client.stop();
});

test('same-topic bursts stay specific and other performances do not invalidate this view', () => {
  const client = setup();
  client.emit('foreign-topic', 'another-show'); client.flush();
  assert.deepEqual(client.changes, []);
  client.emit('topic-a'); client.emit('topic-a'); client.flush();
  client.emit('topic-b'); client.flush();
  assert.deepEqual(client.changes, ['topic-a', 'topic-b']);
  client.stop();
});

test('reconnect refresh cannot be narrowed by a later topic event and reads the latest token', () => {
  const client = setup();
  client.handlers.get('connect')(); client.emit('topic-a'); client.flush();
  assert.deepEqual(client.changes, [undefined]);
  assert.deepEqual(client.connections, [true]);
  client.setToken('refreshed-session');
  client.options.auth((auth) => assert.deepEqual(auth, { token: 'refreshed-session' }));
  client.stop();
});

test('disconnected visible view refreshes, hidden view waits, and cleanup stops all work', () => {
  const client = setup();
  const poll = [...client.intervals.values()][0];
  client.socket.connected = false;
  client.document.hidden = true; poll(); client.flush();
  assert.deepEqual(client.changes, []);
  client.document.hidden = false; poll(); client.flush();
  assert.deepEqual(client.changes, [undefined]);
  assert.equal(client.connectCount(), 2);
  client.emit('topic-a'); client.stop(); client.flush();
  assert.deepEqual(client.changes, [undefined]);
  assert.equal(client.isDisconnected(), true);
  for (const collection of [client.timeouts, client.intervals, client.windowEvents, client.documentEvents]) assert.equal(collection.size, 0);
});
