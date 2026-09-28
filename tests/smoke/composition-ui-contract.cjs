/* Focused offline checks: no Vite config, environment files, database, server or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const filename = path.join(root, 'frontend/src/lib/domain/composition.ts');
const attachmentFilename = path.join(root, 'frontend/src/lib/domain/composition-attachments.ts');
const program = ts.createProgram([filename, attachmentFilename], {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, types: [], skipLibCheck: true
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
}));
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});
const helper = { exports: {} };
new Function('module', 'exports', compiled.outputText)(helper, helper.exports);
const ui = helper.exports;
const attachmentModule = { exports: {} };
const attachmentCode = ts.transpileModule(fs.readFileSync(attachmentFilename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
new Function('module', 'exports', attachmentCode.outputText)(attachmentModule, attachmentModule.exports);
const reference = attachmentModule.exports;
let cases = 0;
function test(name, work) { work(); cases += 1; console.log(`PASS composition: ${name}`); }
function section(id, fields = {}) {
  return { id, parentId: null, title: id, kind: 'CHAPTER', order: 0, scriptText: '', lyrics: '', startMs: null, durationMs: null,
    backgroundMode: 'INHERIT', musicMode: 'INHERIT', scoreMode: 'INHERIT', sourceScriptId: null, sourceSceneId: null, media: [],
    timing: { id, parentId: null, startMs: 0, relativeStartMs: 0, durationMs: 60000, depth: 0, autoStart: true, autoDuration: true }, ...fields };
}
const music = { id: 'music', sectionId: 'parent', assetId: 'asset', slot: 'MUSIC', label: '노래', order: 0,
  offsetMs: 5000, durationMs: null, sourceStartMs: 2000, page: 1, volume: 1, loop: false,
  asset: { id: 'asset', kind: 'AUDIO', mime: 'audio/mpeg', fileName: '요나.mp3', storageKey: 'music/id/file.mp3', sizeBytes: 1024 } };
const parent = section('parent', { musicMode: 'OWN', media: [music] });
const first = section('first', { parentId: 'parent', timing: { ...parent.timing, id: 'first', parentId: 'parent', depth: 1, durationMs: 30000 } });
const second = section('second', { parentId: 'parent', order: 1, timing: { ...first.timing, id: 'second', startMs: 30000, relativeStartMs: 30000 } });
const all = [parent, first, second];

test('child boundaries and exclusive section end', () => {
  assert.equal(ui.activeSection(all, 0).id, 'first');
  assert.equal(ui.activeSection(all, 30000).id, 'second');
  assert.equal(ui.activeSection(all, 60000), null);
  assert.equal(ui.activeSection([], 0), null);
});
test('inherited media keep the parent clock', () => {
  const before = ui.mediaAt(all, first, 'MUSIC', 29999);
  const after = ui.mediaAt(all, second, 'MUSIC', 30000);
  assert.equal(before.media.id, after.media.id);
  assert.equal(after.startMs, 5000);
  assert.equal(ui.sourceTimeSeconds(after, 30000, 120), 27);
  assert.equal(ui.mediaAt(all, first, 'MUSIC', 4999), null);
});
test('NONE and empty OWN never fall back to parent', () => {
  assert.equal(ui.mediaAt(all, { ...first, musicMode: 'NONE' }, 'MUSIC', 10000), null);
  assert.equal(ui.mediaAt(all, { ...first, musicMode: 'OWN' }, 'MUSIC', 10000), null);
  assert.equal(ui.mediaAt(all, first, 'BACKGROUND', 10000), null);
});
test('media clipping uses milliseconds, not visual minimum width', () => {
  const own = section('short', { musicMode: 'OWN', media: [{ ...music, sectionId: 'short', durationMs: 1000 }] });
  assert.equal(ui.mediaAt([own], own, 'MUSIC', 5999).endMs, 6000);
  assert.equal(ui.mediaAt([own], own, 'MUSIC', 6000), null);
});
test('repeated score pages switch at their own offsets', () => {
  const owner = section('score', { scoreMode: 'OWN', media: [{ ...music, id: 'p1', slot: 'SCORE', offsetMs: 0, page: 1 }, { ...music, id: 'p2', slot: 'SCORE', offsetMs: 10000, page: 2 }] });
  assert.equal(ui.mediaAt([owner], owner, 'SCORE', 9999).media.page, 1);
  assert.equal(ui.mediaAt([owner], owner, 'SCORE', 10000).media.page, 2);
});
test('source start, loop and end are bounded', () => {
  const clip = ui.mediaAt(all, first, 'MUSIC', 10000);
  assert.equal(ui.sourceTimeSeconds(clip, 60000, 10), 10);
  assert.equal(ui.sourceTimeSeconds({ ...clip, media: { ...clip.media, loop: true } }, 15000, 10), 4);
  assert.equal(ui.sourceTimeSeconds({ ...clip, media: { ...clip.media, sourceStartMs: 20000 } }, 10000, 10), 10);
});
test('duplicate titles retain independent IDs and hierarchy', () => {
  const ordered = ui.sectionOrder([second, section('last', { order: 1, title: parent.title }), first, parent]);
  assert.deepEqual(ordered.map((s) => s.id), ['parent', 'first', 'second', 'last']);
});
test('numeric inputs reject nonfinite, negative and too-short values', () => {
  assert.equal(ui.secondsInput('1.25'), 1250);
  assert.equal(ui.secondsInput(''), null);
  assert.equal(ui.secondsInput('0'), 0);
  for (const value of ['NaN', 'Infinity', '-1', '86401']) assert.throws(() => ui.secondsInput(value));
  assert.throws(() => ui.secondsInput('', false));
  assert.throws(() => ui.secondsInput('0.1', true, 1000));
});
test('score upload formats are not executable image or HTML types', () => {
  assert.equal(ui.acceptsAsset({ mime: 'application/pdf' }, 'SCORE'), true);
  assert.equal(ui.acceptsAsset({ mime: 'image/png' }, 'SCORE'), true);
  assert.equal(ui.acceptsAsset({ mime: 'image/svg+xml' }, 'SCORE'), false);
  assert.equal(ui.acceptsAsset({ mime: 'text/html' }, 'SOURCE'), false);
  assert.equal(ui.acceptsAsset({ mime: 'video/mp4' }, 'MUSIC'), false);
  assert.equal(ui.acceptsAsset({ mime: 'audio/x-unrecognized' }, 'MUSIC'), false);
  assert.equal(ui.assetName(music.asset), '요나.mp3');
});
test('time display supports hour-long performances', () => {
  assert.equal(ui.formatTime(3601000), '1:00:01');
  assert.equal(ui.formatTime(0), '00:00');
});

test('reference files accept only supported extensions and bounded nonempty originals', () => {
  assert.equal(reference.referenceFileMetadata({ name: '요나와 함께.PDF', size: 1024 }).mimeType, 'application/pdf');
  assert.equal(reference.referenceFileMetadata({ name: '악보.docx', size: 50 * 1024 * 1024 }).size, 50 * 1024 * 1024);
  for (const name of ['readme', 'pdf', '.pdf', 'x.html', 'x.svg', 'score.pdf.exe', '__proto__']) assert.throws(() => reference.referenceFileMetadata({ name, size: 1 }));
  for (const size of [0, -1, NaN, Infinity, 50 * 1024 * 1024 + 1]) assert.throws(() => reference.referenceFileMetadata({ name: 'x.pdf', size }));
});
test('reference library excludes playback media and unsafe file formats', () => {
  assert.equal(reference.isReferenceAsset({ mime: 'application/pdf', sizeBytes: 100 }), true);
  assert.equal(reference.isReferenceAsset({ mime: 'audio/mpeg', sizeBytes: 100 }), false);
  assert.equal(reference.isReferenceAsset({ mime: 'text/html', sizeBytes: 100 }), false);
  assert.equal(reference.isReferenceAsset({ mime: 'text/plain', sizeBytes: 0 }), false);
});
test('reference groups show only own and direct parent attachments, never sibling files', () => {
  const shared = { ...music, id: 'shared', slot: 'SOURCE' };
  const root = { ...parent, media: [shared, music] };
  const child = { ...first, media: [{ ...shared, id: 'own', sectionId: first.id }] };
  const sibling = { ...second, media: [{ ...shared, id: 'sibling', sectionId: second.id }] };
  const groups = reference.referenceGroups([root, child, sibling], child);
  assert.deepEqual(groups.map((group) => group.files.map((file) => file.id)), [['own'], ['shared']]);
  assert.deepEqual(groups.map((group) => group.inherited), [false, true]);
  assert.equal(reference.referenceGroups([root, child], root).length, 1);
});
test('attachment links preserve signed query strings and do not accept executable schemes', () => {
  const links = reference.referenceUrls('https://example.test/api/assets/id/mock-object?action=download&signature=abc');
  assert.equal(new URL(links.download).searchParams.get('signature'), 'abc');
  assert.equal(new URL(links.download).searchParams.get('download'), '1');
  assert.equal(reference.referenceUrls('/api/assets/id/mock-object?signature=abc').open, '/api/assets/id/mock-object?signature=abc');
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///tmp/test', '//other.test/file', 'https://user:pass@example.test/file']) assert.throws(() => reference.referenceUrls(url));
});

const { compile } = require(require.resolve('svelte/compiler', { paths: [path.join(root, 'frontend')] }));
const newScreens = [
  'frontend/src/lib/components/app/composition-section-form.svelte',
  'frontend/src/lib/components/app/composition-section-list.svelte',
  'frontend/src/lib/components/app/composition-media-links.svelte',
  'frontend/src/lib/components/app/composition-import-form.svelte',
  'frontend/src/lib/components/app/composition-reading.svelte',
  'frontend/src/lib/components/app/composition-workspace.svelte',
  'frontend/src/lib/components/app/composition-attachments.svelte',
  'frontend/src/lib/components/app/section-reference-viewer.svelte',
  'frontend/src/routes/app/p/[pid]/composition/+page.svelte'
];
let newWarnings = 0;
let compileErrors = 0;
for (const relative of [...newScreens, 'frontend/src/routes/app/+layout.svelte']) {
  const file = path.join(root, relative);
  for (const generate of ['client', 'server']) {
    let result;
    try { result = compile(fs.readFileSync(file, 'utf8'), { filename: file, generate }); }
    catch (error) {
      compileErrors += 1;
      console.error(`FAIL ${relative}:${error.start?.line ?? '?'} ${error.code ?? 'compile'}: ${error.message}\n${error.frame ?? ''}`);
      continue;
    }
    for (const warning of result.warnings) {
      console.warn(`${relative}:${warning.start?.line ?? '?'} ${warning.code}: ${warning.message}`);
      if (newScreens.includes(relative)) newWarnings += 1;
    }
  }
}
assert.equal(compileErrors, 0, 'Composition component compilation failed; see bounded diagnostics above');
assert.equal(newWarnings, 0, 'New composition components must not introduce compiler or accessibility warnings');
console.log(`PASS: ${cases} composition UI domain cases; strict domain TypeScript check; ${newScreens.length + 1} Svelte client/server syntax compilations. This is NOT a full frontend typecheck, production build or browser test.`);
