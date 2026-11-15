// 대본 파일(.docx/.pdf/.txt)과 영상 폴더로 공연을 구성하는 개발용 도구.
// 로컬 개발 서버와 backend/.env의 SEED_ADMIN_* 계정을 사용한다. 실제 실행은 공연·AI·파일 저장을 변경한다.
//
//   node scripts/setup-production.mjs draft --script <파일> --title <공연 제목>
//   node scripts/setup-production.mjs apply
//   node scripts/setup-production.mjs media --media <폴더> --map <매핑.json>
//
// .local-dev/setup-production.json에는 재시도용 공연 ID·AI 초안·파일 매핑을 저장한다. 보관·정리는 DEVELOPMENT.md 참고.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const errorCodes = new Set(['SETUP_FAILED', 'SETUP_ARGUMENTS', 'SETUP_HTTP_ERROR', 'SETUP_STATE_INVALID', 'SETUP_AI_HTTP_ERROR', 'SETUP_AI_STREAM_INVALID', 'SETUP_AI_FAILED', 'SETUP_AI_RESULT_MISSING', 'SETUP_UPLOAD_ERROR']);
const stages = new Set(['arguments', 'env-read', 'state-read', 'state-save', 'login', 'production-create', 'script-read', 'script-extract', 'ai-request', 'ai-stream', 'script-apply', 'composition-read', 'composition-preview', 'composition-apply', 'mapping-read', 'media-read', 'media-reserve', 'media-upload', 'media-link']);
const safeStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const mimeOf = (name) => ({
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/x-m4a'
})[extname(name).toLowerCase()] ?? 'application/octet-stream';

class SetupError extends Error {
  constructor(code, status) {
    super(code);
    this.setupCode = code;
    this.status = safeStatus(status);
  }
}

// import는 환경 파일·인증·네트워크를 건드리지 않는다. 출력은 고정 문구와 검증된 숫자만 사용한다.
export async function runSetupProduction({ root = defaultRoot, argv = process.argv.slice(2), fetch = globalThis.fetch, log = console.log } = {}) {
  let stage = 'arguments';
  const emit = (message) => log(`[setup] ${message}`);
  try {
    const [command, ...rest] = argv;
    const flags = Object.fromEntries(rest.flatMap((value, index) => (value.startsWith('--') ? [[value.slice(2), rest[index + 1]]] : [])));
    if (!['draft', 'apply', 'media'].includes(command)) throw new SetupError('SETUP_ARGUMENTS');
    const statePath = join(root, '.local-dev', 'setup-production.json');
    stage = 'env-read';
    const env = parseEnv(await readFile(join(root, 'backend', '.env'), 'utf8'));
    const api = `http://127.0.0.1:${env.PORT || 3000}${env.API_PREFIX || '/api/v1'}`;
    stage = 'state-read';
    let state = {};
    let savedState;
    try { savedState = await readFile(statePath, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (savedState !== undefined) {
      await chmod(statePath, 0o600);
      try { state = JSON.parse(savedState); } catch { throw new SetupError('SETUP_STATE_INVALID'); }
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new SetupError('SETUP_STATE_INVALID');
    }
    const save = async () => {
      stage = 'state-save';
      await mkdir(join(root, '.local-dev'), { recursive: true, mode: 0o700 });
      // mode는 새 파일에만 적용되므로 기존 재시도 파일의 권한도 먼저 제한한다.
      try { await chmod(statePath, 0o600); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    };

    let token = '';
    const request = async (path, { method = 'GET', body, form, headers = {} } = {}) => {
      const response = await fetch(`${api}${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        body: form ?? (body ? JSON.stringify(body) : undefined)
      });
      // 실패 본문은 대본·회원 정보·공급자 오류를 포함할 수 있으므로 읽거나 출력하지 않는다.
      if (!response.ok) throw new SetupError('SETUP_HTTP_ERROR', response.status);
      const text = await response.text();
      return text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    };
    const login = async () => {
      stage = 'login';
      const result = await request('/auth/login', { method: 'POST', body: { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD } });
      token = result.tokens.accessToken;
      emit('관리자 로그인 완료');
    };
    const summarize = (draftValue) => {
      const acts = draftValue.acts;
      const scenes = acts.flatMap((act) => act.scenes);
      const lines = scenes.flatMap((scene) => scene.lines);
      const cues = scenes.flatMap((scene) => scene.cues);
      emit(`초안 집계 막=${acts.length} 장면=${scenes.length} 대사=${lines.length} 큐=${cues.length}`);
    };
    const draft = async () => {
      stage = 'arguments';
      if (!flags.script || !flags.title) throw new SetupError('SETUP_ARGUMENTS');
      await login();
      if (!state.productionId) {
        stage = 'production-create';
        const created = await request('/productions', { method: 'POST', body: { title: flags.title, venue: flags.venue } });
        state.productionId = created.id ?? created.production?.id;
        await save();
        emit('공연 생성 완료');
      }
      const pid = state.productionId;
      if (flags['reuse-draft'] && state.draft) { state.scriptTitle = flags.title; await save(); emit('저장된 AI 초안 재사용'); return; }
      stage = 'script-read';
      const buffer = await readFile(resolve(flags.script));
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeOf(flags.script) }), basename(flags.script));
      stage = 'script-extract';
      const extracted = await request(`/productions/${pid}/ai/extract`, { method: 'POST', form });
      const chars = safeCount(extracted.chars);
      emit(`대본 텍스트 추출 완료${chars === undefined ? '' : ` chars=${chars}`}`);
      stage = 'ai-request';
      const response = await fetch(`${api}/productions/${pid}/ai/cue-draft/stream`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: extracted.text })
      });
      if (!response.ok) throw new SetupError('SETUP_AI_HTTP_ERROR', response.status);
      stage = 'ai-stream';
      let result = null;
      let buffered = '';
      for await (const chunk of response.body) {
        buffered += Buffer.from(chunk).toString('utf8');
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          let event;
          try { event = JSON.parse(line); } catch { throw new SetupError('SETUP_AI_STREAM_INVALID'); }
          if (event.type === 'progress') {
            const done = safeCount(event.done), total = safeCount(event.total);
            if (done !== undefined && total !== undefined && done <= total) emit(`AI 분석 진행 done=${done} total=${total}`);
          }
          if (event.type === 'error') throw new SetupError('SETUP_AI_FAILED', event.status);
          if (event.type === 'result') result = event;
        }
      }
      if (!result) throw new SetupError('SETUP_AI_RESULT_MISSING');
      state.draft = result.draft;
      state.scriptTitle = flags.title;
      await save();
      emit('AI 초안 저장 완료');
      summarize(result.draft);
    };
    const apply = async () => {
      stage = 'arguments';
      if (!state.draft || !state.productionId) throw new SetupError('SETUP_ARGUMENTS');
      await login();
      const pid = state.productionId;
      if (!state.scriptId) {
        stage = 'script-apply';
        const applied = await request(`/productions/${pid}/ai/cue-draft/apply`, { method: 'POST', body: { scriptTitle: state.scriptTitle, draft: state.draft } });
        state.scriptId = applied.scriptId;
        await save();
        emit('대본·역할·큐 적용 완료');
      }
      if (!state.composed) {
        stage = 'composition-read';
        const board = await request(`/productions/${pid}/composition`);
        stage = 'composition-preview';
        const preview = await request(`/productions/${pid}/composition/imports/preview`, { method: 'POST', body: { scriptId: state.scriptId } });
        stage = 'composition-apply';
        const result = await request(`/productions/${pid}/composition/imports/apply`, { method: 'POST', body: { expectedRevision: board.revision, sections: preview.sections } });
        state.composed = true;
        await save();
        const sections = Array.isArray(result.ids) ? result.ids.length : undefined;
        emit(`장·막 구성 완료${sections === undefined ? '' : ` sections=${sections}`}`);
      }
    };
    const media = async () => {
      stage = 'arguments';
      if (!state.productionId || !flags.media || !flags.map) throw new SetupError('SETUP_ARGUMENTS');
      await login();
      const pid = state.productionId;
      stage = 'mapping-read';
      const mapping = JSON.parse(await readFile(resolve(flags.map), 'utf8'));
      state.assets ??= {};
      const upload = async (file) => {
        if (state.assets[file]) return state.assets[file];
        stage = 'media-read';
        const body = await readFile(join(resolve(flags.media), file));
        const type = mimeOf(file);
        stage = 'media-reserve';
        const created = await request('/assets', { method: 'POST', body: { purpose: 'CUE_MEDIA', productionId: pid, fileName: file, mimeType: type, size: body.length } });
        const url = created.upload.url.startsWith('http') ? created.upload.url : `${api.replace(/\/api\/v1$/, '')}${created.upload.url}`;
        stage = 'media-upload';
        const put = await fetch(url, { method: created.upload.method || 'PUT', headers: { 'content-type': type }, body });
        if (!put.ok) throw new SetupError('SETUP_UPLOAD_ERROR', put.status);
        state.assets[file] = created.asset.id;
        await save();
        emit(`미디어 업로드 완료 bytes=${body.length}`);
        return created.asset.id;
      };
      // 매핑에 쓰이지 않은 영상도 라이브러리에서 선택할 수 있게 저장한다.
      for (const file of mapping.library ?? []) await upload(file);
      for (const item of mapping.sections) {
        stage = 'composition-read';
        const board = await request(`/productions/${pid}/composition`);
        const section = board.sections.find((candidate) => new RegExp(item.match).test(candidate.title) && !candidate.deletedAt);
        if (!section) { emit('연결할 구간 없음'); continue; }
        const linked = new Set((section.media ?? []).map((link) => link.slot));
        for (const slot of ['BACKGROUND', 'MUSIC']) {
          const file = item[slot === 'BACKGROUND' ? 'video' : 'music'];
          if (!file || linked.has(slot)) continue;
          const assetId = await upload(file);
          const durationMs = section.timing?.durationMs;
          // 이전 연결이 개정 번호를 올릴 수 있어 저장 직전에 다시 읽는다.
          stage = 'composition-read';
          const { revision } = await request(`/productions/${pid}/composition`);
          stage = 'media-link';
          await request(`/productions/${pid}/composition/sections/${section.id}/media`, { method: 'POST', body: {
            expectedRevision: revision, assetId, slot, label: file.replace(/\.[^.]+$/, ''), loop: true,
            ...(durationMs ? { durationMs } : {}), volume: slot === 'MUSIC' ? 0.6 : 0
          } });
          emit(slot === 'BACKGROUND' ? '배경 미디어 연결 완료' : '음원 연결 완료');
        }
      }
    };
    await ({ draft, apply, media })[command]();
    return 0;
  } catch (error) {
    const code = error instanceof SetupError && errorCodes.has(error.setupCode) ? error.setupCode : 'SETUP_FAILED';
    const safeStage = stages.has(stage) ? stage : 'arguments';
    const status = error instanceof SetupError ? safeStatus(error.status) : undefined;
    emit(`실패 code=${code} stage=${safeStage}${status === undefined ? '' : ` status=${status}`}`);
    return code === 'SETUP_ARGUMENTS' ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSetupProduction();
}
