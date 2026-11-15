const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../../backend/node_modules/typescript');
const root = path.resolve(__dirname, '../..');
const moduleSource = fs.readFileSync(path.join(root, 'frontend/src/lib/domain/workspace-navigation.ts'), 'utf8');
const compiled = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const implementation = { exports: {} };
new Function('module', 'exports', compiled)(implementation, implementation.exports);
const { productionNavigation, workspaceTitle } = implementation.exports;
const access = (overrides = {}) => ({
  canEditProduction: false, canManageMembers: false, canViewMembers: false,
  canManageStaffAssignments: false, canEditCasting: false, canEditPlanning: false,
  canViewReadiness: false, canEditChecklist: false, canManageTracks: false,
  canEditMusic: false, canManageRecruitment: false, canEditSchedule: false,
  canCreateSchedule: false, scheduleEditScope: 'NONE', canViewSensitive: false,
  ...overrides
});
const labels = (items) => items.map((item) => item.title);

test('권한 조회 전과 일반 참여자에게 제작 관리 메뉴를 열지 않는다', () => {
  const navigation = productionNavigation('show', access(), false);
  assert.deepEqual(navigation.manage, []);
  assert.deepEqual(labels(navigation.production.slice(0, 3)), ['공연 홈', '대본 읽기', '개인 연습']);
  assert.deepEqual(labels(navigation.mobile), ['공연 홈', '대본 읽기', '개인 연습', '일정', '팀 게시판']);
});

test('음악감독은 큐 작업과 기획 메모를 보되 설정·멤버·캐스팅·체크 편집 메뉴를 받지 않는다', () => {
  const navigation = productionNavigation('show', access({ canManageTracks: true, canEditMusic: true, canEditPlanning: true }), false);
  assert.deepEqual(labels(navigation.manage), ['기획 메모']);
  assert.deepEqual(labels(navigation.production.slice(0, 3)), ['공연 홈', '대본·자료', '큐시트']);
});

test('무대감독의 멤버 조회와 직무 설정은 역할·캐스팅·공연 설정 쓰기로 확대되지 않는다', () => {
  const navigation = productionNavigation('show', access({ canViewMembers: true, canManageStaffAssignments: true, canManageTracks: true, canEditPlanning: true, canEditChecklist: true }), false);
  assert.deepEqual(labels(navigation.manage), ['준비 체크리스트', '기획 메모', '멤버']);
});

test('각 기능의 capability만 해당 메뉴를 열고 URL은 현재 공연에 한정된다', () => {
  const navigation = productionNavigation('new-show', access({ canEditProduction: true, canManageMembers: true, canViewMembers: true, canEditCasting: true, canEditPlanning: true, canEditChecklist: true, canManageRecruitment: true }), false);
  assert.deepEqual(labels(navigation.manage), ['준비 체크리스트', '기획 메모', '캐스팅', '멤버', '배우·스태프 모집', '공연 설정']);
  for (const item of [...navigation.production, ...navigation.manage, ...navigation.mobile]) assert.ok(item.url.startsWith('/app/p/new-show'));
  assert.equal(workspaceTitle('/app/p/new-show/manage/recruitment', 'new-show', navigation.production, navigation.manage), '배우·스태프 모집');
});

test('담당 트랙은 작업 순서만 바꾸고 제작 권한을 추가하지 않는다', () => {
  const navigation = productionNavigation('show', access(), true);
  assert.deepEqual(labels(navigation.production.slice(0, 3)), ['공연 홈', '큐시트', '개인 연습']);
  assert.deepEqual(navigation.manage, []);
});

test('공연 밖 모바일 메뉴 4개와 모집 상세 제목을 유지한다', () => {
  const navigation = productionNavigation(null, access(), false);
  assert.deepEqual(labels(navigation.mobile), ['내 공연', '내 일정', '모집 찾기', '알림']);
  assert.equal(workspaceTitle('/app/opportunities/round', null, [], []), '참여할 공연 찾기');
  assert.equal(workspaceTitle('/app/privacy', null, [], []), '수신 동의 관리');
  assert.equal(workspaceTitle('/app', null, [], []), '내 공연');
});
