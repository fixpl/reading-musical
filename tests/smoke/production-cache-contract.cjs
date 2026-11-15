const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'frontend/src/lib/api/productions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function setup(request) {
  let token = 'actor-session';
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(module, module.exports, (name) => {
    assert.equal(name, './client');
    return { getAccessToken: () => token, apiRequest: () => request(token) };
  });
  return { list: module.exports.listMyProductions, switchAccount: (value) => { token = value; } };
}

test('같은 배우의 공연 목록은 캐시하고 새로고침 요청은 다시 읽는다', async () => {
  let calls = 0;
  const client = setup(async () => [{ id: String(++calls) }]);
  assert.deepEqual(await client.list(), [{ id: '1' }]);
  assert.deepEqual(await client.list(), [{ id: '1' }]);
  assert.deepEqual(await client.list({ fresh: true }), [{ id: '2' }]);
});

test('같은 브라우저에서 다른 계정에 로그인하면 이전 공연·권한을 반환하지 않는다', async () => {
  const client = setup(async (token) => [{ id: token, myMembership: { roles: token === 'actor-session' ? ['ACTOR'] : ['STAFF'] } }]);
  await client.list();
  client.switchAccount('staff-session');
  const rows = await client.list();
  assert.equal(rows[0].id, 'staff-session');
  assert.deepEqual(rows[0].myMembership.roles, ['STAFF']);
});

test('로그아웃 후 캐시된 공연 목록을 볼 수 없다', async () => {
  const client = setup(async (token) => {
    if (!token) throw new Error('Unauthorized');
    return [{ id: 'private-production' }];
  });
  await client.list();
  client.switchAccount(null);
  await assert.rejects(client.list(), /Unauthorized/);
});

test('이전 계정의 늦은 응답이 새 계정 목록으로 재사용되지 않는다', async () => {
  let resolveActor;
  const client = setup((token) => token === 'actor-session' ? new Promise((resolve) => { resolveActor = resolve; }) : Promise.resolve([{ id: 'staff-production' }]));
  const actorRequest = client.list();
  client.switchAccount('staff-session');
  await client.list();
  resolveActor([{ id: 'actor-production' }]);
  await actorRequest;
  assert.deepEqual(await client.list(), [{ id: 'staff-production' }]);
});
