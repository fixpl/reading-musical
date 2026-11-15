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
const { buildCompositionRehearsal } = domain('rehearsal-timeline');
const { exportRange, frameAt, assetsInRange, mediaInRange, pickRecorderMime, estimateExport, exportFileName, wrapLines, MAX_EXPORT_MS } = domain('timeline-export');

const asset = (id, kind, mime) => ({ id, kind, mime, fileName: id, storageKey: id, sizeBytes: 1 });
const media = (id, slot, assetFile, fields = {}) => ({ id, slot, assetId: assetFile.id, asset: assetFile, label: id, order: 0, offsetMs: 0, durationMs: null, sourceStartMs: 0, page: 1, volume: 1, loop: false, ...fields });
const section = (id, startMs, durationMs, fields = {}) => ({ id, title: id, kind: 'SCENE', order: 0, parentId: null, scriptText: '', lyrics: '', sourceSceneId: null, backgroundMode: 'INHERIT', musicMode: 'INHERIT', scoreMode: 'INHERIT', media: [], timing: { startMs, durationMs, depth: fields.parentId ? 1 : 0 }, ...fields });
function source(sections, characters = []) {
  const rehearsal = buildCompositionRehearsal(sections, [], [], characters);
  return { sections, items: rehearsal.items, scenes: rehearsal.scenes, fromComposition: true, totalMs: rehearsal.totalMs, defaultBackground: null };
}
const video = asset('video-a', 'VIDEO', 'video/mp4');
const song = asset('song-a', 'AUDIO', 'audio/mpeg');
const act = section('1막', 0, 100000, { kind: 'ACT', backgroundMode: 'OWN', media: [media('bg', 'BACKGROUND', video, { loop: true })] });
const sceneA = section('장면 A', 0, 40000, { parentId: '1막', order: 0, scriptText: '요나: 첫 대사', musicMode: 'OWN', media: [media('bgm', 'MUSIC', song, { offsetMs: 5000, sourceStartMs: 2000, volume: 0.5 })] });
const sceneB = section('장면 B', 40000, 60000, { parentId: '1막', order: 1, scriptText: '[ 조명이 식는다 ]' });
const data = source([act, sceneA, sceneB], [{ id: 'yona', name: '요나' }]);

test('scope resolves the current scene, its act, everything and a custom range to ms', () => {
  assert.deepEqual(exportRange(data, 'SCENE', 50000).range, { startMs: 40000, endMs: 100000, label: '장면 B' });
  assert.deepEqual(exportRange(data, 'ACT', 50000).range, { startMs: 0, endMs: 100000, label: '1막' });
  assert.deepEqual(exportRange(data, 'ALL', 0).range, { startMs: 0, endMs: 100000, label: '전체' });
  assert.deepEqual(exportRange(data, 'CUSTOM', 0, { startMs: 10000, endMs: 20000 }).range, { startMs: 10000, endMs: 20000, label: '구간' });
});
test('invalid ranges are refused with a Korean message', () => {
  assert.match(exportRange(data, 'CUSTOM', 0, { startMs: 20000, endMs: 20000 }).error, /요\.$/);
  assert.match(exportRange(data, 'CUSTOM', 0, { startMs: 0, endMs: 300 }).error, /1초/);
  assert.match(exportRange({ ...data, totalMs: 0 }, 'ALL', 0).error, /요\.$/);
  const long = source([section('긴 구간', 0, MAX_EXPORT_MS + 1000)]);
  assert.match(exportRange(long, 'ALL', 0).error, /3시간/);
  assert.match(exportRange(data, 'SCENE', 500000).error, /장면/);
});
test('frame at time t uses the rehearsal clock: caption, scene title, inherited background and music offset', () => {
  const early = frameAt(data, 1000);
  assert.equal(early.sceneTitle, '장면 A');
  assert.deepEqual(early.captions.map((c) => [c.speaker, c.text]), [['요나', '첫 대사']]);
  assert.equal(early.background.assetId, 'video-a');
  assert.equal(early.background.timeSec, 1);
  assert.equal(early.background.loop, true);
  assert.equal(early.audio.length, 0, 'music starts at its 5s offset');
  const later = frameAt(data, 8000);
  assert.equal(later.audio[0].assetId, 'song-a');
  assert.equal(later.audio[0].timeSec, 5, 'source starts at 2s and 3s have elapsed');
  assert.equal(later.audio[0].volume, 0.5);
  const direction = frameAt(data, 50000);
  assert.equal(direction.sceneTitle, '장면 B');
  assert.equal(direction.captions.length, 0);
  assert.equal(direction.note.label, '무대 지문');
  assert.equal(direction.background.assetId, 'video-a', 'child inherits the act background clock');
  assert.equal(direction.background.timeSec, 50);
});
test('assets in a range are collected once for pre-signing', () => {
  assert.deepEqual(assetsInRange(data, { startMs: 0, endMs: 20000, label: 'x' }).sort(), ['song-a', 'video-a']);
  assert.deepEqual(assetsInRange(data, { startMs: 0, endMs: 4000, label: 'x' }), ['video-a']);
});
test('preloading includes sub-second composition media and cue transitions', () => {
  const flash = asset('flash', 'IMAGE', 'image/png');
  const short = source([section('짧은 자료', 0, 10000, { backgroundMode: 'OWN', media: [media('flash-bg', 'BACKGROUND', flash, { offsetMs: 1250, durationMs: 200 })] })]);
  short.items.push({ id: 'short-cue', kind: 'cue', sceneId: '짧은 자료', startMs: 2500, durationMs: 100, cue: { asset: song } });
  assert.deepEqual(assetsInRange(short, { startMs: 0, endMs: 5000, label: 'x' }).sort(), ['flash', 'song-a']);
  assert.deepEqual(mediaInRange(short, { startMs: 1000, endMs: 5000, label: 'x' }).map((item) => item.key), ['bg:flash-bg', 'cue-audio:short-cue']);
  assert.deepEqual(assetsInRange(short, { startMs: 3000, endMs: 5000, label: 'x' }), []);
});
test('legacy script export maps inherited clip boundaries onto its scene clock', () => {
  const inherited = section('막', 100000, 10000, { kind: 'ACT', musicMode: 'OWN', media: [media('legacy-song', 'MUSIC', song, { offsetMs: 1250, durationMs: 200 })] });
  const connected = section('연결 구간', 100000, 10000, { parentId: '막', sourceSceneId: 'legacy-scene' });
  const legacy = { sections: [inherited, connected], fromComposition: false, totalMs: 30000, defaultBackground: null,
    scenes: [{ id: 'legacy-scene', title: '대본 장면', order: 0, act: { id: '막', title: '막', order: 0 } }],
    items: [{ id: 'line', kind: 'line', sceneId: 'legacy-scene', startMs: 20000, durationMs: 10000, block: { type: 'DIALOGUE', text: '이어서 읽어요', character: null } }] };
  assert.equal(frameAt(legacy, 21250).audio[0].assetId, 'song-a');
  assert.deepEqual(assetsInRange(legacy, { startMs: 20000, endMs: 25000, label: 'x' }), ['song-a']);
  assert.deepEqual(exportRange(legacy, 'ACT', 22000).range, { startMs: 20000, endMs: 30000, label: '막' });
});
test('recorder mime prefers mp4 and only then falls back to webm with a notice flag', () => {
  assert.deepEqual(pickRecorderMime(() => true), { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', fallback: false });
  assert.deepEqual(pickRecorderMime((m) => m === 'video/mp4'), { mime: 'video/mp4', extension: 'mp4', fallback: false });
  assert.deepEqual(pickRecorderMime((m) => m.startsWith('video/webm;codecs=vp9')), { mime: 'video/webm;codecs=vp9,opus', extension: 'webm', fallback: true });
  assert.equal(pickRecorderMime(() => false), null);
});
test('estimate, file name and caption wrapping', () => {
  const est = estimateExport({ startMs: 0, endMs: 61000, label: 'x' }, '720');
  assert.equal(est.seconds, 61);
  assert.ok(est.bytes > 20_000_000 && est.bytes < 40_000_000, String(est.bytes));
  assert.equal(exportFileName('봄 / 리딩: 뮤지컬', '1막', 'mp4'), '봄_리딩_뮤지컬_1막.mp4');
  assert.equal(exportFileName('', '', 'webm'), '공연_연습.webm');
  const measure = (value) => value.length * 10;
  assert.deepEqual(wrapLines('가나 다라 마바사', 50, measure), ['가나 다라', '마바사']);
  assert.deepEqual(wrapLines('가나다라마바사', 30, measure), ['가나다', '라마바', '사']);
  assert.deepEqual(wrapLines('하나\n둘', 100, measure), ['하나', '둘']);
});
