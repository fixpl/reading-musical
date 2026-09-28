import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildLocalConfig, parseArguments, parseListenerPids } from '../../scripts/local-dev.mjs';

const backend = { DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/musical?schema=public', JWT_ACCESS_SECRET: 'test-only-access-secret', JWT_REFRESH_SECRET: 'test-only-refresh-secret', NVIDIA_API_KEY: 'test-only-provider-key' };

test('defaults and explicit local commands', () => {
  assert.equal(parseArguments([]).mode, 'dev');
  assert.equal(parseArguments([]).allowRemoteDb, false);
  assert.equal(parseArguments(['--allow-remote-db']).allowRemoteDb, true);
  assert.equal(parseArguments(['check', '--allow-remote-db']).mode, 'check');
  assert.equal(parseArguments(['--allow-remote-db', 'preview']).mode, 'preview');
  assert.equal(parseArguments(['dev', '--migrate', '--allow-remote-db']).allowRemoteDb, true);
  assert.equal(parseArguments(['preview']).mode, 'preview');
  assert.equal(parseArguments(['dev', '--migrate']).migrate, true);
  assert.equal(parseArguments(['--help']).help, true);
  assert.throws(() => parseArguments(['check', '--migrate']));
  assert.throws(() => parseArguments(['dev', 'preview']));
  assert.throws(() => parseArguments(['--reset']));
});

test('API, WebSocket, CORS, cookies and bound ports agree', () => {
  const config = buildLocalConfig(backend);
  assert.equal(config.backendPort, 3000);
  assert.equal(config.frontendPort, 5179);
  assert.equal(config.backendEnv.HOST, '127.0.0.1');
  assert.equal(config.backendEnv.APP_PUBLIC_URL, config.webOrigin);
  assert.ok(config.backendEnv.CORS_ORIGINS.includes(config.webOrigin));
  assert.equal(config.frontendEnv.PUBLIC_API_BASE_URL, `${config.apiOrigin}/api/v1`);
  assert.equal(config.frontendEnv.PUBLIC_WS_URL, `${config.apiOrigin}/ws`);
  assert.equal(config.backendEnv.AUTH_REFRESH_COOKIE_SECURE, 'false');
  assert.equal(config.backendEnv.MAIL_TRANSPORT, 'json');
});

test('backend secrets never enter the generated frontend environment', () => {
  const config = buildLocalConfig(backend, { PRIVATE_KEY: 'never-share', PUBLIC_API_BASE_URL: 'https://old.invalid' }, { PATH: '/bin', DATABASE_URL: backend.DATABASE_URL, NVIDIA_API_KEY: 'inherited-secret' });
  const frontend = JSON.stringify(config.frontendEnv);
  for (const value of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'NVIDIA_API_KEY', 'inherited-secret', 'never-share', 'old.invalid']) assert.ok(!frontend.includes(value));
  assert.equal(config.frontendEnv.PATH, '/bin');
});

test('custom local ports and prefix move together', () => {
  const config = buildLocalConfig(backend, {}, { DEV_BACKEND_PORT: '3010', DEV_FRONTEND_PORT: '5180', API_PREFIX: '/api/v2/' });
  assert.equal(config.frontendEnv.PUBLIC_API_BASE_URL, 'http://127.0.0.1:3010/api/v2');
  assert.equal(config.backendEnv.APP_PUBLIC_URL, 'http://127.0.0.1:5180');
  assert.equal(config.backendEnv.PORT, '3010');
});

test('keeps remote access opt-in and rejects query-parameter host overrides', () => {
  for (const DATABASE_URL of ['postgresql://local:local@db.example.com:5432/musical', 'postgresql://localhost/musical?host=db.example.com', 'postgresql://127.0.0.1/musical?service=production', 'https://localhost/musical', 'invalid']) {
    assert.throws(() => buildLocalConfig({ ...backend, DATABASE_URL }));
  }
  assert.doesNotThrow(() => buildLocalConfig({ ...backend, DATABASE_URL: 'postgresql://local:local@[::1]:5432/musical' }));
});

test('rejects production and staging even with explicit remote access', () => {
  const options = parseArguments(['--allow-remote-db']);
  const remote = { ...backend, DATABASE_URL: 'postgresql://test:test@dev-db.example.test:5432/musical', DEV_ALLOW_REMOTE_DB: 'true' };
  assert.throws(() => buildLocalConfig({ ...remote, NODE_ENV: 'production' }, {}, {}, options));
  assert.throws(() => buildLocalConfig(remote, { PUBLIC_APP_ENV: 'staging' }, {}, options));
  assert.throws(() => buildLocalConfig(remote, {}, { NODE_ENV: 'production' }, options));
  assert.throws(() => buildLocalConfig(remote, {}, { PUBLIC_APP_ENV: 'staging' }, options));
});

test('explicit remote access keeps the app local and preserves DB connection options', () => {
  for (const host of ['dev-db.example.test', '192.168.10.20', '10.0.0.25']) {
    const DATABASE_URL = `postgresql://test:test@${host}:5432/musical?schema=public&sslmode=require`;
    const config = buildLocalConfig({ ...backend, DATABASE_URL }, {}, {}, parseArguments(['--allow-remote-db']));
    assert.equal(config.databaseIsRemote, true);
    assert.equal(config.backendEnv.DATABASE_URL, DATABASE_URL);
    assert.equal(config.backendEnv.HOST, '127.0.0.1');
    assert.equal(config.frontendEnv.PUBLIC_API_BASE_URL, 'http://127.0.0.1:3000/api/v1');
    assert.equal(config.frontendEnv.PUBLIC_WS_URL, 'http://127.0.0.1:3000/ws');
    assert.equal(config.frontendEnv.DATABASE_URL, undefined);
  }
  assert.equal(buildLocalConfig(backend).databaseIsRemote, false);
});

test('remote permission can persist in backend env or be explicitly set in the terminal', () => {
  const remote = { ...backend, DATABASE_URL: 'postgresql://test:test@dev-db.example.test:5432/musical' };
  assert.equal(buildLocalConfig({ ...remote, DEV_ALLOW_REMOTE_DB: 'true' }).databaseIsRemote, true);
  assert.equal(buildLocalConfig(remote, {}, { DEV_ALLOW_REMOTE_DB: 'true' }).databaseIsRemote, true);
  assert.throws(() => buildLocalConfig({ ...remote, DEV_ALLOW_REMOTE_DB: 'false' }));
  assert.throws(() => buildLocalConfig({ ...remote, DEV_ALLOW_REMOTE_DB: 'true' }, {}, { DEV_ALLOW_REMOTE_DB: 'false' }));
  assert.throws(() => buildLocalConfig({ ...remote, DEV_ALLOW_REMOTE_DB: 'yes' }), /DEV_ALLOW_REMOTE_DB/);
  assert.throws(() => buildLocalConfig(remote, { DEV_ALLOW_REMOTE_DB: 'true' }));
});

test('remote access does not authorize remote migration', () => {
  const remote = { ...backend, DATABASE_URL: 'postgresql://test:test@dev-db.example.test:5432/musical' };
  const options = parseArguments(['--allow-remote-db', '--migrate']);
  assert.throws(() => buildLocalConfig(remote, {}, {}, options), /원격 개발 DB의 migration/);
  assert.throws(() => buildLocalConfig({ ...remote, DEV_ALLOW_REMOTE_DB: 'true' }, {}, {}, parseArguments(['--migrate'])), /원격 개발 DB의 migration/);
  assert.doesNotThrow(() => buildLocalConfig(backend, {}, {}, parseArguments(['--migrate'])));
  assert.doesNotThrow(() => buildLocalConfig(remote, {}, {}, parseArguments(['check', '--allow-remote-db'])));
});

test('remote permission does not bypass URL validation or host query restrictions', () => {
  for (const DATABASE_URL of ['https://dev-db.example.test/musical', 'postgresql://dev-db.example.test/', 'postgresql://dev-db.example.test/musical#fragment', 'invalid', 'postgresql://localhost/musical?host=dev-db.example.test', 'postgresql://dev-db.example.test/musical?service=production']) {
    assert.throws(() => buildLocalConfig({ ...backend, DATABASE_URL }, {}, {}, parseArguments(['--allow-remote-db'])));
  }
});

test('DB guard errors do not expose connection credentials and terminal URL takes precedence', () => {
  const DATABASE_URL = 'postgresql://private-user:private-password@private-db.example.test:5432/private_db';
  let message = '';
  try { buildLocalConfig(backend, {}, { DATABASE_URL }); } catch (error) { message = error.message; }
  assert.match(message, /--allow-remote-db/);
  for (const part of ['private-user', 'private-password', 'private-db', 'private_db']) assert.ok(!message.includes(part));
  assert.equal(buildLocalConfig(backend, {}, { DATABASE_URL }, parseArguments(['--allow-remote-db'])).backendEnv.DATABASE_URL, DATABASE_URL);
});

test('rejects invalid, shared and database ports', () => {
  for (const DEV_BACKEND_PORT of ['0', '80', '65536', '3000oops', '5179', '5432']) {
    assert.throws(() => buildLocalConfig(backend, {}, { DEV_BACKEND_PORT }));
  }
  assert.throws(() => buildLocalConfig({ ...backend, JWT_ACCESS_SECRET: '' }));
});

test('PID parsing is bounded to valid positive process identifiers', () => {
  assert.deepEqual(parseListenerPids('123\n456\n123\n'), [123, 456]);
  assert.deepEqual(parseListenerPids(''), []);
  assert.throws(() => parseListenerPids('-1'));
  assert.throws(() => parseListenerPids('1'));
  assert.throws(() => parseListenerPids('123; rm'));
});

test('shell and Node launcher syntax, with no servers or environment files loaded', () => {
  const shell = fileURLToPath(new URL('../../dev.sh', import.meta.url));
  const node = fileURLToPath(new URL('../../scripts/local-dev.mjs', import.meta.url));
  const shellResult = spawnSync('/bin/sh', ['-n', shell], { encoding: 'utf8', timeout: 5000 });
  const nodeResult = spawnSync(process.execPath, ['--check', node], { encoding: 'utf8', timeout: 5000 });
  assert.equal(shellResult.status, 0, shellResult.stderr);
  assert.equal(nodeResult.status, 0, nodeResult.stderr);
  const help = spawnSync('/bin/sh', [shell, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--allow-remote-db/);
  assert.match(help.stdout, /DEV_ALLOW_REMOTE_DB/);
  const source = readFileSync(node, 'utf8');
  assert.ok(!source.includes('pkill'));
  assert.ok(!source.includes("['migrate', 'reset']"));
});
