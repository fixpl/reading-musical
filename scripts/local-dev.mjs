import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';

const entryPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(entryPath), '..');
const pause = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const allowedQueryKeys = new Set(['schema', 'sslmode', 'sslaccept', 'connect_timeout', 'connection_limit', 'pool_timeout', 'pgbouncer', 'statement_timeout', 'application_name']);

export function parseArguments(args) {
  let mode = 'dev';
  let modeSet = false;
  let migrate = false;
  let allowRemoteDb = false;
  for (const argument of args) {
    if (argument === '--help' || argument === '-h') return { help: true, mode, migrate: false, allowRemoteDb: false };
    if (argument === '--migrate') { migrate = true; continue; }
    if (argument === '--allow-remote-db') { allowRemoteDb = true; continue; }
    if (['dev', 'preview', 'check'].includes(argument) && !modeSet) {
      mode = argument; modeSet = true; continue;
    }
    throw new Error(`지원하지 않는 옵션: ${argument}. sh dev.sh --help를 확인하세요.`);
  }
  if (mode === 'check' && migrate) throw new Error('check는 읽기 전용입니다. DB 적용은 sh dev.sh dev --migrate를 사용하세요.');
  return { help: false, mode, migrate, allowRemoteDb };
}

function portNumber(value, label) {
  const text = String(value);
  const port = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${label}는 1024~65535 사이 정수여야 합니다.`);
  }
  return port;
}

export function buildLocalConfig(backend, frontend = {}, inherited = {}, options = {}) {
  for (const mode of [backend.NODE_ENV, inherited.NODE_ENV, frontend.PUBLIC_APP_ENV, inherited.PUBLIC_APP_ENV]) {
    if (mode && !['development', 'test', 'local'].includes(mode.trim().toLowerCase())) {
      throw new Error('운영·staging 설정은 로컬 실행기에 사용할 수 없습니다. 개발용 환경설정을 분리하세요.');
    }
  }
  // Exported terminal variables take precedence over backend/.env, as before.
  const merged = { ...backend, ...inherited };
  const remoteSetting = (merged.DEV_ALLOW_REMOTE_DB || 'false').trim().toLowerCase();
  if (!['true', 'false'].includes(remoteSetting)) throw new Error('DEV_ALLOW_REMOTE_DB는 true 또는 false로 설정하세요.');
  const allowRemoteDb = options.allowRemoteDb === true || remoteSetting === 'true';
  let database;
  const invalidDatabaseMessage = 'DATABASE_URL은 호스트와 DB 이름이 포함된 PostgreSQL URL이어야 합니다. backend/.env와 터미널의 DATABASE_URL 설정을 확인하세요.';
  try { database = new URL(merged.DATABASE_URL); } catch { throw new Error(invalidDatabaseMessage); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || database.pathname.length < 2 || database.hash) {
    throw new Error(invalidDatabaseMessage);
  }
  for (const key of database.searchParams.keys()) {
    // Do not let query parameters silently replace the explicitly checked host.
    if (!allowedQueryKeys.has(key)) throw new Error('DATABASE_URL에 지원하지 않는 연결 옵션이 있습니다. host/service 재지정은 허용하지 않습니다.');
  }
  const databaseIsRemote = !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname.toLowerCase());
  if (databaseIsRemote && !allowRemoteDb) {
    throw new Error('DATABASE_URL이 로컬 DB 주소가 아니어서 접속 전에 중단했습니다. 원격 개발 DB가 맞으면 sh dev.sh --allow-remote-db 또는 backend/.env의 DEV_ALLOW_REMOTE_DB=true를 사용하세요. 운영 DB에는 사용하지 마세요.');
  }
  // Remote access is an explicit development choice, not permission to migrate it.
  if (databaseIsRemote && options.migrate === true) {
    throw new Error('원격 개발 DB의 migration은 통합 실행기에서 적용하지 않습니다. --migrate를 제거하고, 대상 DB를 확인한 별도 절차로 적용하세요.');
  }
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!merged[key]?.trim()) throw new Error(`backend/.env에 ${key}가 필요합니다.`);
  }
  const backendPort = portNumber(merged.DEV_BACKEND_PORT || merged.PORT || '3000', '백엔드 포트');
  const frontendPort = portNumber(merged.DEV_FRONTEND_PORT || '5179', '프론트 포트');
  const dbPort = Number(database.port || '5432');
  if (backendPort === frontendPort || [backendPort, frontendPort].includes(dbPort)) {
    throw new Error('백엔드·프론트·DB 포트는 서로 달라야 합니다. DB 프로세스는 종료하지 않습니다.');
  }
  const apiPrefix = `/${(merged.API_PREFIX || '/api/v1').replace(/^\/+|\/+$/g, '')}`;
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(apiPrefix)) throw new Error('API_PREFIX 형식을 확인하세요.');
  const apiOrigin = `http://127.0.0.1:${backendPort}`;
  const webOrigin = `http://127.0.0.1:${frontendPort}`;
  const safeBase = Object.fromEntries(Object.entries(inherited).filter(([key]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_ALL|TERM|USER|LOGNAME|SHELL|FORCE_COLOR)$/.test(key)));
  const publicConfig = Object.fromEntries(Object.entries(frontend).filter(([key]) => key.startsWith('PUBLIC_')));
  return {
    backendPort, frontendPort, apiOrigin, webOrigin, databaseIsRemote,
    backendEnv: {
      ...merged, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(backendPort), API_PREFIX: apiPrefix,
      APP_PUBLIC_URL: webOrigin, API_EXTERNAL_URL: apiOrigin,
      CORS_ORIGINS: `${webOrigin},http://localhost:${frontendPort}`,
      AUTH_REFRESH_COOKIE_SECURE: 'false', AUTH_REFRESH_COOKIE_SAMESITE: 'lax', RATE_LIMIT_TRUST_PROXY: 'false',
      MAIL_TRANSPORT: 'json', ASSET_OBJECT_DIR: join(root, 'backend', '.asset-objects'),
      CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1'
    },
    // Do not pass backend credentials to the frontend process.
    frontendEnv: {
      ...safeBase, ...publicConfig, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(frontendPort), ORIGIN: webOrigin,
      PUBLIC_APP_ENV: 'development', PUBLIC_API_BASE_URL: `${apiOrigin}${apiPrefix}`,
      PUBLIC_WS_URL: `${apiOrigin}/ws`, PUBLIC_STORE_REFRESH_TOKEN: 'false'
    }
  };
}

export function parseListenerPids(output) {
  return [...new Set(output.trim().split(/\s+/).filter(Boolean).map((value) => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 1) throw new Error('포트 조회에서 올바르지 않은 PID를 받았습니다.');
    return Number(value);
  }))];
}

async function loadEnvFile(path, required) {
  try { return parseEnv(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' && !required) return {};
    if (error.code === 'ENOENT') throw new Error('backend/.env가 없습니다. backend/.env.example을 복사하고 개발용 DB·JWT 설정을 입력하세요.');
    throw new Error('환경설정 파일을 읽지 못했습니다. 접근 권한을 확인하세요. 비밀파일 보호를 우회하지 않습니다.');
  }
}

function listeners(port) {
  const result = spawnSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 5000 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('lsof로 포트를 확인하지 못했습니다. macOS/Linux에서 lsof 설치·권한을 확인하세요.');
  return parseListenerPids(result.stdout || '').filter((pid) => pid !== process.pid && pid !== process.ppid);
}

function signal(pid, name, group = false) {
  try { process.kill(group ? -pid : pid, name); }
  catch (error) { if (error.code !== 'ESRCH') throw new Error(`PID ${pid} 종료 권한을 확인하세요.`); }
}

async function releasePort(port) {
  const initial = listeners(port);
  for (const pid of initial) {
    console.log(`[local] 포트 ${port}의 PID ${pid} 종료 요청`);
    signal(pid, 'SIGTERM');
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!listeners(port).length) return;
    await pause(150);
  }
  // Only force-stop the original listeners, never a new unrelated process that took the port.
  for (const pid of listeners(port).filter((pid) => initial.includes(pid))) signal(pid, 'SIGKILL');
  await pause(200);
  if (listeners(port).length) throw new Error(`포트 ${port}가 다시 점유되었습니다. 기존 watch 서버를 원래 터미널에서 종료하세요.`);
}

async function checkDatabase(config) {
  const requireBackend = createRequire(join(root, 'backend', 'package.json'));
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString: config.backendEnv.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    console.log('[local] PostgreSQL 연결 확인 (SELECT 1, 데이터 변경 없음)');
  } catch (error) {
    throw new Error(`개발 DB 연결 검사 실패 (${String(error.code || 'connection')}). DB 접속 허용·네트워크·DATABASE_URL을 확인하세요.`);
  } finally { await client.end().catch(() => {}); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('사용법: sh dev.sh [dev|preview|check] [--migrate] [--allow-remote-db]\n  dev: 두 개발 서버 시작·포트 재사용\n  preview: 로컬 빌드 후 두 서버 시작 (운영 배포 아님)\n  check: 설정·의존성·DB 연결·migration 상태만 확인\n  --allow-remote-db: 명시적으로 원격 개발 DB 사용. 운영 DB 사용 금지\n  DEV_ALLOW_REMOTE_DB=true: 같은 허용을 backend/.env 또는 터미널에서 설정\n  --migrate: 로컬 DB에만 기존 migration 적용. 원격 DB 적용/reset/seed/설치는 실행하지 않음\n  원격 개발 DB 검사: sh dev.sh check --allow-remote-db\n  포트 변경: DEV_BACKEND_PORT=3001 DEV_FRONTEND_PORT=5180 sh dev.sh');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 이상이 필요합니다.');
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('이 실행기는 macOS/Linux 로컬 개발 전용입니다.');
  process.chdir(root);
  const config = buildLocalConfig(await loadEnvFile(join(root, 'backend', '.env'), true), await loadEnvFile(join(root, 'frontend', '.env'), false), process.env, options);
  if (config.databaseIsRemote) {
    console.warn('[local] 원격 개발 DB 사용을 명시적으로 허용했습니다. 기동한 앱의 저장·수정은 해당 DB에 반영됩니다. 운영 DB를 사용하지 마세요.');
  }
  const backendDir = join(root, 'backend');
  const frontendDir = join(root, 'frontend');
  const prisma = join(backendDir, 'node_modules/prisma/build/index.js');
  const nest = join(backendDir, 'node_modules/@nestjs/cli/bin/nest.js');
  const vite = join(frontendDir, 'node_modules/vite/bin/vite.js');
  for (const file of [prisma, nest, vite]) {
    try { await access(file); } catch { throw new Error('의존성이 없습니다. 루트·backend·frontend에서 npm ci를 실행하세요. 자동 설치는 하지 않습니다.'); }
  }

  const children = new Set();
  const statePath = join(root, '.local-dev', `${config.backendPort}-${config.frontendPort}.json`);
  let ownsState = false;
  let stopping = false;
  const cleanupState = async () => {
    if (!ownsState) return;
    try {
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      if (state.pid === process.pid) await unlink(statePath);
    } catch (error) { if (error.code !== 'ENOENT') console.warn('[local] 실행 상태 파일을 정리하지 못했습니다.'); }
  };
  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    const owned = [...children];
    for (const child of owned) { try { signal(child.pid, 'SIGTERM', true); } catch {} }
    await pause(1200);
    for (const child of owned) { try { signal(child.pid, 'SIGKILL', true); } catch {} }
    await cleanupState();
    process.exit(code);
  };
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(name, () => { void shutdown(0); });
  const redact = (text) => Object.entries(config.backendEnv)
    .filter(([key, value]) => /SECRET|PASSWORD|API_KEY|DATABASE_URL/.test(key) && typeof value === 'string' && value.length >= 4)
    .reduce((output, [, value]) => output.split(value).join('[redacted]'), String(text));
  const launch = (label, cwd, entry, args, env, persistent = false) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, env, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.stdout.on('data', (data) => process.stdout.write(`[${label}] ${redact(data)}`));
    child.stderr.on('data', (data) => process.stderr.write(`[${label}] ${redact(data)}`));
    if (persistent) {
      child.once('error', () => { console.error(`[${label}] 서버 시작 실패`); void shutdown(1); });
      child.once('exit', (code) => {
        if (!stopping) { console.error(`[${label}] 서버가 종료되어 함께 정리합니다 (exit ${code ?? 'signal'}).`); void shutdown(1); }
      });
    }
    return child;
  };
  const run = (label, cwd, entry, args, env) => new Promise((resolveRun, reject) => {
    console.log(`[local] ${label}`);
    const child = launch(label, cwd, entry, args, env);
    const timer = setTimeout(() => { try { signal(child.pid, 'SIGKILL', true); } catch {} }, 120000);
    child.once('error', () => { clearTimeout(timer); children.delete(child); reject(new Error(`${label} 실행 실패`)); });
    child.once('exit', (code, reason) => {
      clearTimeout(timer); children.delete(child);
      if (code === 0 && !reason) resolveRun();
      else reject(new Error(`${label} 실패 (exit ${code ?? reason}). 서버를 시작하지 않습니다.`));
    });
  });
  const waitFor = async (url, label) => {
    for (let count = 0; count < 120; count += 1) {
      if (stopping) throw new Error('실행이 중단되었습니다.');
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {}
      await pause(500);
    }
    throw new Error(`${label} 준비 상태 확인 실패: ${url}`);
  };

  try {
    await run('Prisma schema validate', backendDir, prisma, ['validate'], config.backendEnv);
    await checkDatabase(config);
    if (options.migrate) await run('개발 DB migration deploy', backendDir, prisma, ['migrate', 'deploy'], config.backendEnv);
    await run('DB migration status', backendDir, prisma, ['migrate', 'status'], config.backendEnv);
    if (options.mode === 'check') {
      console.log('[local] 설정·의존성·DB 연결·migration 상태 확인 완료. 서버/포트/데이터 변경 없음.');
      return;
    }
    await run('Prisma client generate', backendDir, prisma, ['generate'], config.backendEnv);
    if (options.mode === 'preview') {
      await run('backend build', backendDir, nest, ['build'], config.backendEnv);
      await run('frontend build', frontendDir, vite, ['build'], { ...config.frontendEnv, NODE_ENV: 'production' });
    }
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    try {
      const previous = JSON.parse(await readFile(statePath, 'utf8'));
      if (!Number.isSafeInteger(previous.pid) || previous.pid <= 1 || previous.pid === process.pid || previous.root !== root) throw new Error('실행 상태 파일 검증 실패');
      const command = spawnSync('ps', ['-p', String(previous.pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 });
      const cwd = spawnSync('lsof', ['-a', '-p', String(previous.pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 3000 });
      if (command.error || cwd.error) throw new Error('이전 실행기 확인 실패');
      if (command.status === 0) {
        if (!command.stdout.includes(entryPath) || !cwd.stdout.split('\n').includes(`n${root}`)) throw new Error('이전 PID의 소유권을 확인하지 못해 종료하지 않습니다.');
        signal(previous.pid, 'SIGTERM');
        for (let attempt = 0; attempt < 30; attempt += 1) {
          try { await access(statePath); } catch { break; }
          await pause(100);
        }
      } else {
        await unlink(statePath);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(statePath, JSON.stringify({ pid: process.pid, root }), { flag: 'wx', mode: 0o600 });
    ownsState = true;
    await releasePort(config.backendPort);
    await releasePort(config.frontendPort);
    console.log('[local] 로컬 전용 · 메일 실제 발송 없음 · Ctrl+C로 두 서버 종료');
    launch('api', backendDir, options.mode === 'dev' ? nest : join(backendDir, 'dist/src/main.js'), options.mode === 'dev' ? ['start', '--watch'] : [], config.backendEnv, true);
    await waitFor(`${config.apiOrigin}/health/ready`, '백엔드/DB');
    launch('web', frontendDir, vite, [options.mode === 'dev' ? 'dev' : 'preview', '--host', '127.0.0.1', '--port', String(config.frontendPort), '--strictPort'], { ...config.frontendEnv, NODE_ENV: options.mode === 'preview' ? 'production' : 'development' }, true);
    await waitFor(config.webOrigin, '프론트');
    console.log(`\n[local] 준비 완료\n  메인: ${config.webOrigin}\n  로그인: ${config.webOrigin}/login\n  API 문서: ${config.apiOrigin}/api/docs\n  종료: Ctrl+C\n`);
  } catch (error) {
    console.error(`[local] ${redact(error instanceof Error ? error.message : error)}`);
    await shutdown(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === entryPath) {
  main().catch((error) => { console.error(`[local] ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
}
