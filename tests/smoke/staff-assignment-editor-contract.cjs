const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../../backend/node_modules/typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/lib/domain/staff-assignment-editor.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const implementation = { exports: {} };
new Function('module', 'exports', compiled)(implementation, implementation.exports);
const { staffAssignmentInput } = implementation.exports;

test('기본 직무만 저장해도 기존 이름과 대표 담당 표시를 보존한다', () => {
  const previous = [{ discipline: 'SOUND', customLabel: '음향 총괄', isLead: true }];
  assert.deepEqual(staffAssignmentInput(['SOUND', 'LIGHTING'], [], previous), [
    { discipline: 'SOUND', customLabel: '음향 총괄', isLead: true },
    { discipline: 'LIGHTING', customLabel: null, isLead: false }
  ]);
});

test('기존 복수 OTHER 직무를 빈 라벨이나 대표 담당 해제로 덮어쓰지 않는다', () => {
  const previous = [{ discipline: 'OTHER', customLabel: '자막 운영', isLead: true }, { discipline: 'OTHER', customLabel: '관객 설문', isLead: false }];
  assert.deepEqual(staffAssignmentInput(['OTHER', 'SOUND'], previous.map((item) => item.customLabel), previous), [
    ...previous, { discipline: 'SOUND', customLabel: null, isLead: false }
  ]);
});

test('새 기타 직무는 이름을 필수로 받고 앞뒤 공백을 정리한다', () => {
  for (const labels of [[], [''], ['   ']]) assert.throws(() => staffAssignmentInput(['OTHER'], labels, []), /기타 직무 이름/);
  assert.deepEqual(staffAssignmentInput(['OTHER'], ['  자막 운영  '], []), [{ discipline: 'OTHER', customLabel: '자막 운영', isLead: false }]);
  assert.throws(() => staffAssignmentInput(['OTHER'], ['가'.repeat(81)], []), /80자/);
});

test('서버 assignmentKey와 동일하게 중복 이름을 사전 거부한다', () => {
  assert.throws(() => staffAssignmentInput(['OTHER'], ['자막 운영', '자막-운영'], []), /같은 기타 직무/);
  assert.throws(() => staffAssignmentInput(['OTHER'], ['Caption', 'caption'], []), /같은 기타 직무/);
});

test('기타 선택 해제는 입력 중인 라벨과 무관하게 기타 직무를 제외한다', () => {
  assert.deepEqual(staffAssignmentInput(['SOUND'], [''], [{ discipline: 'OTHER', customLabel: '자막', isLead: true }]), [{ discipline: 'SOUND', customLabel: null, isLead: false }]);
  assert.deepEqual(staffAssignmentInput([], [], []), []);
});
