const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../backend/node_modules/typescript');

// 읽기 화면의 실제 복원 함수를 실행해 처음 방문한 배우의 글자 크기와 배역 선택을 확인한다.
const component = fs.readFileSync(path.join(__dirname, '../../frontend/src/routes/app/p/[pid]/script/+page.svelte'), 'utf8');
const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const source = ts.createSourceFile('reader.ts', script, ts.ScriptTarget.ES2022, true);
const fn = name => {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(source);
};
const code = ts.transpileModule(`
  const SIZES = [0.95, 1.1, 1.3, 1.55], pid = 'show';
  let sizeIndex = 1, mine = '', looseLines = true, minePreferenceSaved = false;
  ${fn('restoreReadingPreferences')}
  ${fn('selectInitialRole')}
  return { restoreReadingPreferences, selectInitialRole, state: () => ({ sizeIndex, size: SIZES[sizeIndex], mine, looseLines }) };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const create = new Function('localStorage', code);
const storage = (values = {}) => ({ getItem: key => values[key] ?? null });
const viewer = { characters: [{ id: 'cast-1', name: '요나' }, { id: 'cast-2', name: '해설' }], viewer: { myCharacterIds: ['cast-1'] } };

test('a first visit keeps the readable 1.1rem default instead of treating missing storage as zero', () => {
  const reader = create(storage());
  reader.restoreReadingPreferences('show');
  assert.equal(reader.state().size, 1.1);
  assert.equal(reader.state().looseLines, true);
  reader.selectInitialRole(viewer);
  assert.equal(reader.state().mine, '요나');
});

test('an explicitly saved smallest size is restored, but invalid saved sizes use the default', () => {
  const compact = create(storage({ 'artbridge-read-size': '0' }));
  compact.restoreReadingPreferences('show');
  assert.equal(compact.state().size, 0.95);
  for (const value of ['', ' ', '-1', '4', 'invalid']) {
    const reader = create(storage({ 'artbridge-read-size': value }));
    reader.restoreReadingPreferences('show');
    assert.equal(reader.state().size, 1.1, value);
  }
});

test('a saved role or explicitly disabled highlight takes precedence over assigned casting', () => {
  for (const role of ['해설', '']) {
    const reader = create(storage({ 'artbridge-read-mine-show': role }));
    reader.restoreReadingPreferences('show');
    reader.selectInitialRole(viewer);
    assert.equal(reader.state().mine, role);
  }
});

test('unavailable local storage or missing casting never prevents reading with defaults', () => {
  const reader = create({ getItem() { throw new Error('storage unavailable'); } });
  reader.restoreReadingPreferences('show');
  reader.selectInitialRole(null);
  assert.equal(reader.state().size, 1.1);
  assert.equal(reader.state().mine, '');
});

test('casting lookup failure does not fail the script composition load', async () => {
  const loadCode = ts.transpileModule(`
    const pid = 'show', requestVersion = 1;
    let scripts = [], composition = null, showComposition = false, loadError = '', loading = true;
    ${fn('loadPage')}
    return { loadPage, state: () => ({ composition, loadError, loading }) };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let initialRole;
  const reader = new Function('apiRequest', 'selectInitialRole', 'open', loadCode)(async url => {
    if (url.endsWith('/cue-sheet')) throw new Error('casting unavailable');
    if (url.endsWith('/scripts')) return [];
    return { sections: [{ id: 'scene' }] };
  }, value => { initialRole = value; }, assert.fail);
  await reader.loadPage('show', new AbortController().signal, 1);
  assert.equal(initialRole, null);
  assert.equal(reader.state().composition.sections[0].id, 'scene');
  assert.equal(reader.state().loadError, '');
  assert.equal(reader.state().loading, false);
});

// 개인 기록의 저장 키는 재생 중인 장면과 무관하게 사용자가 선택한 기록 범위를 유지해야 한다.
const { parse } = require('../../frontend/node_modules/svelte/compiler');
const live = fs.readFileSync(path.join(__dirname, '../../frontend/src/routes/app/p/[pid]/live/+page.svelte'), 'utf8');
let recordComponent;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Component' && node.name === 'RehearsalRecord') { recordComponent = node; return; }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(parse(live, { modern: true }));
assert.ok(recordComponent);
const scopeExpression = name => {
  const { expression } = recordComponent.attributes.find(attribute => attribute.name === name).value;
  return live.slice(expression.start, expression.end);
};
const recordScope = new Function('selectedScene', 'fromComposition', 'scenes', 'memoUnitKey', 'memoUnitTitle',
  `return { key: ${scopeExpression('unitKey')}, title: ${scopeExpression('unitTitle')} };`);

test('first entry keeps previously stored overview notes and completion visible while a scene is playing', () => {
  const scope = recordScope('', true, [{ id: 'a', title: '첫 장면' }], 'section:a', '첫 장면');
  const saved = { notes: { overview: '기존 전체 공연 메모' }, completedKeys: ['overview'] };
  assert.deepEqual(scope, { key: 'overview', title: '전체 공연' });
  assert.equal(saved.notes[scope.key], '기존 전체 공연 메모');
  assert.equal(saved.completedKeys.includes(scope.key), true);
});

test('explicitly selected composition and legacy scenes retain their existing personal record keys', () => {
  for (const [composition, prefix] of [[true, 'section'], [false, 'scene']]) {
    assert.deepEqual(recordScope('chosen', composition, [{ id: 'chosen', title: '선택한 장면' }], 'section:playing', '재생 중인 장면'),
      { key: `${prefix}:chosen`, title: '선택한 장면' });
  }
});
