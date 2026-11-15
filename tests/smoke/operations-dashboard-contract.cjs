const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../backend/node_modules/typescript');

// 화면에 표시하는 실제 집계 함수를 실행해 새 단계나 '해당 없음'이 잘못 집계되는 일을 막는다.
function loadModule(relative, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/domain', relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(imports, name), `unexpected import: ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}
const labels = loadModule('labels.ts');
const { countProductionPhases, nextRehearsalTask, rehearsalPreparationSteps, readinessStepState, readinessStepLink } = loadModule('operations-dashboard.ts', { '$lib/domain/labels': labels });

test('empty dashboard includes each configured phase with zero counts', () => {
  const rows = countProductionPhases([]);
  assert.deepEqual(rows.map(row => row.key), Object.keys(labels.PHASE_LABELS));
  assert.equal(rows.every(row => row.count === 0), true);
});

test('each registered production counts once, including a newly introduced phase', () => {
  const rows = countProductionPhases(['PLANNING', 'PLANNING', 'PERFORMANCE', 'NEW_PHASE'].map(currentPhase => ({ currentPhase })));
  assert.equal(rows.reduce((sum, row) => sum + row.count, 0), 4);
  assert.equal(rows.find(row => row.key === 'PLANNING').count, 2);
  assert.deepEqual(rows.find(row => row.key === 'NEW_PHASE'), { key: 'NEW_PHASE', label: 'NEW_PHASE', count: 1 });
});

test('an explicitly unnecessary background stays separate from missing or registered media', () => {
  assert.equal(readinessStepState({ key: 'video', done: true, detail: '해당 없음' }), '해당 없음');
  assert.equal(readinessStepState({ key: 'video', done: false, detail: '0/2개 장면' }), '추가 필요');
  assert.equal(readinessStepState({ key: 'video', done: true, detail: '2/2개 장면' }), '등록됨');
});

test('status actions open the matching production and casting screen', () => {
  assert.equal(readinessStepLink('show-a', 'casting'), '/app/p/show-a/manage/casting');
  assert.equal(readinessStepLink('show-b', 'schedule'), '/app/p/show-b/schedule');
  assert.equal(readinessStepLink('show-a', 'video'), '/app/p/show-a/composition?tab=videos');
});

test('a registered script with an empty scene directs the planner to the composition form', () => {
  const show = {
    steps: [{ key: 'script', label: '대본·구성', done: true, detail: '장면 1개' }],
    scriptPreparation: { hasMaterial: false, hasRegisteredScript: true, hasLinkedScene: false }
  };
  assert.deepEqual(nextRehearsalTask(show), { key: 'script', label: '장면 구성하기', query: '?tab=import' });
  assert.deepEqual(rehearsalPreparationSteps(show), [{ ...show.steps[0], done: false, detail: '구성 전' }]);
  show.scriptPreparation.hasLinkedScene = true;
  assert.deepEqual(nextRehearsalTask(show), { key: 'script', label: '장면 내용 입력하기' });
});

test('the next action follows the first rehearsal workflow and keeps optional materials out of it', () => {
  const steps = ['script', 'members', 'schedule', 'video', 'cues'].map(key => ({ key, done: false }));
  const show = { steps, casting: { done: false, detail: '0/2개 배역 배정' } };
  assert.equal(nextRehearsalTask(show).key, 'script');
  steps[0].done = true;
  assert.equal(nextRehearsalTask(show).key, 'members');
  steps[1].done = true;
  assert.equal(nextRehearsalTask(show).key, 'casting');
  show.casting.detail = '배역 없음';
  assert.equal(nextRehearsalTask(show).query, '?create=1');
  steps[2].done = true;
  assert.equal(nextRehearsalTask(show), null);
});
