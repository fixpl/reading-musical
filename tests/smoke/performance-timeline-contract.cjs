/* Offline regression tests. The root `npm test` runner compiles the backend first. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const contract = require(path.join(root, 'backend/dist/src/ai/ai-contract.js'));
const { RolesGuard } = require(path.join(root, 'backend/dist/src/common/guards/roles.guard.js'));
const { PLATFORM_ROLES_KEY } = require(path.join(root, 'backend/dist/src/common/decorators/platform-roles.decorator.js'));
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'frontend/src/lib/domain/performance-timeline.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const helper = { exports: {} };
new Function('module', 'exports', compiled.outputText)(helper, helper.exports);
const { buildPerformanceTimeline, parseTimelineTime } = helper.exports;
const calendarCompiled = ts.transpileModule(fs.readFileSync(path.join(root, 'frontend/src/lib/domain/schedule-calendar.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const calendarModule = { exports: {} };
new Function('module', 'exports', calendarCompiled.outputText)(calendarModule, calendarModule.exports);
const { groupCalendarDays } = calendarModule.exports;
const { AiService } = require(path.join(root, 'backend/dist/src/ai/ai.service.js'));
const { CueSheetService } = require(path.join(root, 'backend/dist/src/cue-sheet/cue-sheet.service.js'));

async function main() {
  const config = contract.readLlmSettings({ NVIDIA_API_KEY: 'test-placeholder-not-a-real-key' });
  assert.equal(config.baseURL, 'https://integrate.api.nvidia.com/v1');
  assert.equal(config.model, 'deepseek-ai/deepseek-v4-pro-0813');
  assert.equal(config.maxTokens, 16384);
  assert.deepEqual(config.extra, { chat_template_kwargs: { thinking: false } });
  assert.throws(() => contract.readLlmSettings({ NVIDIA_API_KEY: 'test', LLM_BASE_URL: 'https://example.com/v1' }));
  assert.throws(() => contract.readLlmSettings({ NVIDIA_API_KEY: 'test', LLM_EXTRA_BODY_JSON: '{"messages":[]}' }));
  assert.throws(() => contract.readLlmSettings({ NVIDIA_API_KEY: 'test', LLM_TEMPERATURE: 'NaN' }));
  assert.deepEqual(contract.readLlmSettings({ LLM_API_KEY: 'test', LLM_MODEL: 'other-model' }).extra, {});
  assert.equal(contract.parseTimecode('00:01:02.250'), 62250);
  assert.equal(contract.parseTimecode('00:00'), 0);
  assert.throws(() => contract.parseTimecode('00:61'));
  assert.throws(() => contract.milliseconds(-1));
  const source = contract.scriptSource('[00:01 --> 00:03.500] 배우: 안녕하세요.\n[00:04]\n조명 암전');
  assert.equal(source.lines[0].durationMs, 2500);
  assert.equal(source.lines[2].startMs, 4000);
  const draft = { acts: [{ scenes: [{ lines: [{ text: '안녕하세요.', sourceLine: 1, startMs: 999999, durationMs: null }, { text: '조명 암전', sourceLine: 3, startMs: null, durationMs: null }], cues: [{ sourceLine: 3, startMs: 999, seconds: null }] }] }] };
  contract.bindSourceTimes(draft, source.lines);
  assert.equal(draft.acts[0].scenes[0].lines[0].startMs, 1000);
  assert.equal(draft.acts[0].scenes[0].lines[0].durationMs, 2500);
  assert.equal(draft.acts[0].scenes[0].cues[0].startMs, 4000);
  assert.throws(() => contract.bindSourceTimes({ acts: [] }, source.lines));
  assert.throws(() => contract.bindSourceTimes({ acts: [] }, contract.scriptSource('시간 없는 대사도 보존해야 합니다.').lines));
  const duplicate = structuredClone(draft);
  duplicate.acts[0].scenes[0].lines.push({ ...duplicate.acts[0].scenes[0].lines[0] });
  assert.throws(() => contract.bindSourceTimes(duplicate, source.lines));
  assert.throws(() => contract.bindSourceTimes(structuredClone(draft), source.lines, new Set([1])));
  const ai = new AiService({});
  const inputDraft = { acts: [{ title: '1막', scenes: [{ title: '인사', lines: [{ kind: '대사', speaker: '배우', text: '안녕하세요.', sourceLine: 1, startMs: 1000, durationMs: 2500 }], cues: [{ track: '조명', content: '점등', seconds: 2, startMs: 1000, sourceLine: 1 }] }] }] };
  const normalized = ai.normalizeDraft(inputDraft);
  assert.equal(normalized.acts[0].scenes[0].lines[0].durationMs, 2500);
  assert.equal(normalized.acts[0].scenes[0].lines[0].sourceLine, 1);
  assert.equal(normalized.acts[0].scenes[0].cues[0].startMs, 1000);
  assert.throws(() => ai.normalizeDraft({ acts: Array(21).fill(inputDraft.acts[0]) }));
  const malformed = structuredClone(inputDraft);
  malformed.acts[0].scenes[0].cues[0].seconds = -1;
  assert.throws(() => ai.normalizeDraft(malformed));
  const pastEnd = structuredClone(inputDraft);
  pastEnd.acts[0].scenes[0].lines[0].startMs = 86400000;
  assert.throws(() => ai.normalizeDraft(pastEnd));
  const cueService = new CueSheetService({});
  assert.doesNotThrow(() => cueService.assertCueTiming(0, 5));
  assert.doesNotThrow(() => cueService.assertCueTiming(86399000, 1));
  assert.throws(() => cueService.assertCueTiming(86399000, 2));
  assert.throws(() => cueService.assertCueTiming(0, 0.5));
  const localIso = (month, day, hour = 0) => new Date(2026, month, day, hour).toISOString();
  const overnight = { startAt: localIso(8, 7, 23), endAt: localIso(8, 8, 2) };
  const calendar = groupCalendarDays([overnight], (item) => item, 2026, 8);
  assert.equal(calendar.get('2026-09-07').length, 1);
  assert.equal(calendar.get('2026-09-08').length, 1);
  const midnight = groupCalendarDays([{ startAt: localIso(8, 7), endAt: localIso(8, 8) }], (item) => item, 2026, 8);
  assert.equal(midnight.has('2026-09-08'), false, 'Exclusive midnight must not spill into the next day');
  const longLeave = groupCalendarDays([{ startAt: localIso(0, 1), endAt: localIso(11, 31) }], (item) => item, 2026, 8);
  assert.equal(longLeave.size, 42, 'Calendar work must stay bounded');
  assert.equal(groupCalendarDays([{ startAt: 'invalid', endAt: 'invalid' }], (item) => item, 2026, 8).size, 0);
  const crossMonth = groupCalendarDays([{ startAt: localIso(7, 31, 23), endAt: localIso(8, 1, 1) }], (item) => item, 2026, 8);
  assert.equal(crossMonth.has('2026-08-31'), true);
  assert.equal(crossMonth.has('2026-09-01'), true);
  assert.equal(parseTimelineTime('01:02.250'), 62250);
  assert.equal(parseTimelineTime('0'), 0);
  assert.equal(parseTimelineTime(''), null);
  assert.throws(() => parseTimelineTime('1:60'));
  assert.throws(() => parseTimelineTime('-2'));
  const timeline = buildPerformanceTimeline([{ id: 'scene', title: '장면', order: 0, act: { id: 'act', title: '막', order: 0 }, blocks: [{ id: 'line', order: 0, type: 'DIALOGUE', text: '대사', character: null, startMs: 5000, durationMs: 2000 }] }], [{ id: 'cue', trackId: 'track', sceneId: 'scene', cueNumber: '1', content: '조명', startMs: 1000, durationSec: 2 }]);
  assert.equal(timeline.items.find((item) => item.id === 'cue').durationMs, 2000, 'Short cues must not be expanded to 30 seconds');
  assert.equal(timeline.totalMs, 7000);
  assert.equal(timeline.items[0].startMs, 1000);
  assert.equal(timeline.items[0].estimated, false);
  const automatic = buildPerformanceTimeline([], [{ id: 'untimed', trackId: 'track', sceneId: null, cueNumber: '2', content: '자동' }]);
  assert.equal(automatic.items[0].estimated, true);
  let callerOrganization = 'other';
  const reflector = { getAllAndOverride: (key) => key === PLATFORM_ROLES_KEY ? ['SUPER_ADMIN', 'ORG_ADMIN'] : ['ACTOR'] };
  const prisma = { production: { findUnique: async () => ({ organizationId: 'production-org' }) }, user: { findUnique: async () => ({ organizationId: callerOrganization }) }, membership: { findFirst: async () => null } };
  const guard = new RolesGuard(reflector, prisma);
  const context = (role) => ({ getHandler() {}, getClass() {}, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user', platformRole: role }, params: { productionId: 'production' } }) }) });
  await assert.rejects(guard.canActivate(context('ORG_ADMIN')), (error) => error.getStatus() === 403);
  callerOrganization = 'production-org';
  assert.equal(await guard.canActivate(context('ORG_ADMIN')), true);
  assert.equal(await guard.canActivate(context('SUPER_ADMIN')), true);
  await assert.rejects(guard.canActivate(context('MEMBER')), (error) => error.getStatus() === 403);
  // Syntax compilation only: no Vite config, dotenv files, server, or browser is loaded.
  // This does not replace Svelte type checking or a production bundle.
  const { compile } = require(require.resolve('svelte/compiler', { paths: [path.join(root, 'frontend')] }));
  let warnings = 0;
  const svelteFiles = [
    'frontend/src/routes/app/schedule/+page.svelte',
    'frontend/src/routes/app/p/[pid]/live/+page.svelte',
    'frontend/src/routes/+page.svelte',
    'frontend/src/lib/components/landing/ProductPreview.svelte',
    'frontend/src/lib/components/landing/InquiryForm.svelte'
  ];
  for (const relative of svelteFiles) {
    const filename = path.join(root, relative);
    const sourceText = fs.readFileSync(filename, 'utf8');
    for (const generate of ['client', 'server']) {
      const result = compile(sourceText, { filename, generate });
      warnings += result.warnings.length;
      for (const warning of result.warnings) {
        console.warn(`[svelte:${generate}] ${relative}:${warning.start?.line ?? '?'} ${warning.code}: ${warning.message}`);
      }
    }
  }
  console.log(`PASS: Svelte client/server syntax compilation (${svelteFiles.length} screens/components, ${warnings} compiler warnings). Full frontend typecheck/build remain separate gates.`);
  console.log('PASS: NVIDIA settings, AI timing normalization, missing/duplicate source rejection, exact timeline durations, server time bounds, multi-day calendar, and organization authorization. No database or external API called.');
}
require('./composition-ui-contract.cjs');
main().catch((error) => { console.error(error); process.exitCode = 1; });
