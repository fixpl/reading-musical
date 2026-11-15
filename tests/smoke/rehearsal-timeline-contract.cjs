const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../backend/node_modules/typescript');
function domain(name) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/domain', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, (id) => domain(id.replace('./', '')));
  return module.exports;
}
const { buildCompositionRehearsal, isMyRehearsalItem } = domain('rehearsal-timeline');
const { cueSheetModel } = domain('cue-sheet-model');
const { cuesheetCsv } = domain('cuesheet-export');
const section = (id, startMs, durationMs, fields = {}) => ({ id, title: id, order: 0, parentId: null, scriptText: '', lyrics: '', sourceSceneId: null, media: [], timing: { startMs, durationMs }, ...fields });
test('new sections without legacy scenes are rehearsable and resolve the assigned actor', () => {
  const result = buildCompositionRehearsal([section('new', 5000, 6000, { scriptText: '요나: 첫 대사\n해설자: 다음 대사', lyrics: '요나: 노래' })], [], [], [{ id: 'cast', name: '요나' }]);
  assert.equal(result.totalMs, 11000);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].block.character.id, 'cast');
  assert.equal(result.items[0].startMs, 5000);
  assert.equal(result.items.at(-1).startMs + result.items.at(-1).durationMs, 11000);
  assert.equal(result.items.at(-1).block.type, 'LYRIC');
  assert.ok(result.items.every((item) => item.estimated));
});
test('parent and child clocks overlap without adding the parent duration twice', () => {
  const result = buildCompositionRehearsal([section('parent', 0, 60000), section('child', 20000, 10000, { parentId: 'parent', scriptText: '배우: 대사' })], [], [], []);
  assert.equal(result.totalMs, 60000);
  assert.equal(result.items[0].startMs, 20000);
});
test('linked cues keep their local offset when a composition scene is moved', () => {
  const scenes = [{ id: 'old', title: '기존', order: 0, act: { id: 'act', title: '막', order: 0 }, blocks: [{ id: 'line', type: 'DIALOGUE', text: '기존 대사', order: 0, startMs: 10000, durationMs: 8000, character: null }] }];
  const cues = [{ id: 'cue', trackId: 'sound', sceneId: 'old', startMs: 12000, durationSec: 2, content: '효과음', cueNumber: '1' }];
  const result = buildCompositionRehearsal([section('updated', 30000, 10000, { sourceSceneId: 'old', scriptText: '새 대사' })], scenes, cues, []);
  assert.equal(result.items.find((item) => item.kind === 'cue').startMs, 32000);
  assert.equal(result.items.filter((item) => item.kind === 'line').length, 1);
  assert.equal(result.items.find((item) => item.kind === 'line').block.text, '새 대사');
});
test('duplicated linked scenes have distinct rendered cue IDs', () => {
  const scenes = [{ id: 'old', title: '장면', order: 0, act: { id: 'act', title: '막', order: 0 } }];
  const cues = [{ id: 'cue', trackId: 'sound', sceneId: 'old', startMs: 0, durationSec: 2, content: '음향', cueNumber: '1' }];
  const result = buildCompositionRehearsal([section('a', 0, 10000, { sourceSceneId: 'old' }), section('b', 10000, 10000, { sourceSceneId: 'old' })], scenes, cues, []);
  assert.equal(new Set(result.items.map((item) => item.id)).size, result.items.length);
});
test('track-prefixed actions in a new script appear as assigned staff cues', () => {
  const result = buildCompositionRehearsal([section('new', 0, 10000, { scriptText: '조명: 점등\n배우: 안녕하세요' })], [], [], [{ id: 'actor', name: '배우' }], [{ id: 'light', name: '조명' }]);
  assert.equal(result.items[0].kind, 'cue');
  assert.equal(result.items[0].cue.content, '점등');
  assert.ok(isMyRehearsalItem(result.items[0], [], ['light']));
  assert.ok(isMyRehearsalItem(result.items[1], ['actor'], []));
  assert.equal(isMyRehearsalItem(result.items[1], [], ['light']), false);
});
test('empty media-only sections still occupy their configured interval', () => {
  const result = buildCompositionRehearsal([section('media-only', 15000, 20000)], [], [], []);
  assert.equal(result.totalMs, 35000);
  assert.equal(result.items[0].block.type, 'SECTION');
});
test('joint singers count as everyone\'s part and "모두" is every selected actor\'s part', () => {
  const cast = [{ id: 'mom', name: '엄마' }, { id: 'dad', name: '아빠' }, { id: 'son', name: '아들' }, { id: 'all', name: '모두' }];
  const result = buildCompositionRehearsal([section('song', 0, 100000, { lyrics: '엄마·아빠: [ 부부 왈츠 중창 ]\n모두: 마지막 합창' })], [], [], cast);
  const [duet, chorus] = result.items;
  assert.equal(duet.block.character.name, '엄마·아빠');
  assert.ok(isMyRehearsalItem(duet, ['mom'], []) && isMyRehearsalItem(duet, ['dad'], []));
  assert.equal(isMyRehearsalItem(duet, ['son'], []), false);
  assert.ok(isMyRehearsalItem(chorus, ['son'], []));
  assert.equal(isMyRehearsalItem(chorus, [], []), false);
});
test('a bracketed song marker takes most of the section while short lines stay short', () => {
  const result = buildCompositionRehearsal([section('song', 0, 200000, { scriptText: '해설자: 어느 저녁, 두 사람.', lyrics: '엄마: [ 부르듯이 ]' })], [], [], [{ id: 'mom', name: '엄마' }, { id: 'nar', name: '해설자' }]);
  const song = result.items.find((item) => item.block.type === 'LYRIC');
  assert.ok(song.durationMs > 150000, String(song.durationMs));
  assert.equal(result.items.at(-1).startMs + result.items.at(-1).durationMs, 200000);
});
test('stage directions and production notes are different kinds; titles repeated as notes are dropped', () => {
  const result = buildCompositionRehearsal([section('넘버 1', 0, 60000, { title: '넘버 1', scriptText: '[ 조명이 식는다 ]\n※ 편곡 큐: 왈츠 풀 사운드\n※ 넘버 1\n해설자: 안녕' })], [], [], [{ id: 'nar', name: '해설자' }]);
  assert.deepEqual(result.items.map((item) => [item.block.type, item.block.text]), [['STAGE_DIRECTION', '조명이 식는다'], ['NOTE', '편곡 큐: 왈츠 풀 사운드'], ['DIALOGUE', '안녕']]);
  assert.equal(result.items[1].block.character, null);
  assert.ok(result.items[1].durationMs < 100, 'a note takes almost no performance time');
  assert.equal(isMyRehearsalItem(result.items[1], ['nar'], []), false);
});

test('rehearsal, cue studio, table and CSV use the revised composition clock including a manual opening', () => {
  const scenes = [{ id: 'source', title: '원본', order: 0, act: { id: 'act', title: '막', order: 0 }, blocks: [{ id: 'line', order: 0, type: 'DIALOGUE', text: '대사', startMs: 0, durationMs: 10000, character: null }] }];
  const cues = [{ id: 'cue', trackId: 'sound', sceneId: 'source', cueNumber: '1', content: '효과음', startMs: 2000, durationSec: 2 }];
  const sections = [section('manual', 0, 60000), section('revised', 60000, 10000, { order: 1, sourceSceneId: 'source', scriptText: '최신 대사' })];
  const live = buildCompositionRehearsal(sections, scenes, cues, []);
  const sheet = cueSheetModel(sections, scenes, cues, [], []);
  assert.equal(sheet.totalMs, live.totalMs);
  assert.equal(sheet.totalMs, 70000);
  assert.equal(sheet.cues[0].startMs, 62000);
  assert.equal(sheet.cues[0].startMs, live.items.find(item => item.kind === 'cue').startMs);
  assert.equal(sheet.cueSources.get(sheet.cues[0].id).offsetMs, 60000);
  assert.equal(sheet.scenes[1].range.startMs, 60000);
  assert.match(cuesheetCsv(sheet.cues, sheet.scenes, [{ id: 'sound', name: '효과음' }]), /1,1:02,/);
});
test('duplicated scenes map to the original cue while retaining separate display IDs and offsets', () => {
  const scenes = [{ id: 'source', title: '장면', order: 0, act: { id: 'act', title: '막', order: 0 } }];
  const cues = [{ id: 'cue', trackId: 'sound', sceneId: 'source', cueNumber: '1', content: '소리', startMs: 0, durationSec: 1 }];
  const model = cueSheetModel([section('a', 0, 10000, { sourceSceneId: 'source' }), section('b', 10000, 10000, { sourceSceneId: 'source' })], scenes, cues, [], []);
  assert.equal(new Set(model.cues.map(cue => cue.id)).size, 2);
  assert.deepEqual(model.cues.map(cue => model.cueSources.get(cue.id).id), ['cue', 'cue']);
  assert.deepEqual(model.cues.map(cue => cue.startMs - model.cueSources.get(cue.id).offsetMs), [0, 0]);
});
test('staff instructions embedded in new section text also appear in the cue sheet without a second stored copy', () => {
  const model = cueSheetModel([section('new', 0, 10000, { scriptText: '조명: 점등' })], [], [], [], [{ id: 'light', name: '조명' }]);
  assert.equal(model.cues[0].content, '점등');
  assert.equal(model.cues[0].fromComposition, true);
  assert.equal(model.cueSources.size, 0);
  assert.equal(model.cues[0].durationSec, 10);
});
test('cues outside the current composition are retained for the administrator to repair', () => {
  const cues = [{ id: 'unplaced', trackId: 'light', sceneId: 'removed-scene', cueNumber: '1', content: '점등', startMs: 0, durationSec: 1 }];
  const model = cueSheetModel([section('new', 0, 10000)], [], cues, [], []);
  assert.equal(model.cues.length, 0);
  assert.equal(model.unplacedCues[0].id, 'unplaced');
});
test('moving a timed cue cannot move the untimed source scene anchor and cancel the move', () => {
  const scenes = [{ id: 'source', title: '장면', order: 0, act: { id: 'act', title: '막', order: 0 }, blocks: [{ id: 'line', type: 'DIALOGUE', text: '대사', order: 0, durationMs: 10000, character: null }] }];
  const sections = [section('revised', 60000, 10000, { sourceSceneId: 'source' })];
  const cue = { id: 'cue', trackId: 'light', sceneId: 'source', cueNumber: '1', content: '점등', startMs: 0, durationSec: 1 };
  const before = cueSheetModel(sections, scenes, [cue], [], []);
  const rawStart = 62000 - before.cueSources.get(before.cues[0].id).offsetMs;
  const after = cueSheetModel(sections, scenes, [{ ...cue, startMs: rawStart }], [], []);
  assert.equal(rawStart, 2000);
  assert.equal(after.cues[0].startMs, 62000);
  assert.equal(after.totalMs, before.totalMs);
});
