// 활동 기록의 동작 이름(action)을 사람이 읽는 말로 바꾼다. 모르는 동작은 원래 이름을 그대로 보여 준다.
const ACTIONS: Record<string, string> = {
  "production.create": "공연을 만들었어요",
  "production.update": "공연 정보를 수정했어요",
  "production.delete": "공연을 삭제했어요",
  "production.restore": "공연을 복원했어요",
  "production.archive": "공연을 보관했어요",
  "production.duplicate": "공연을 복제했어요",
  "production.member.add": "참여자를 추가했어요",
  "production.member.update": "참여자 역할을 바꿨어요",
  "production.member.remove": "참여자를 내보냈어요",
  "production.position.create": "배역·담당 자리를 만들었어요",
  "production.position.update": "배역·담당 자리를 수정했어요",
  "production.position.delete": "배역·담당 자리를 지웠어요",
  "production.position.replace": "배역·담당 자리를 일괄 바꿨어요",
  "production.staff_assignment.replace": "스태프 담당을 바꿨어요",
  "production.invitation.create": "초대를 보냈어요",
  "production.invitation.revoke": "초대를 취소했어요",
  "script.ai_apply": "AI로 대본을 등록했어요",
  "schedule.assistant_time_changed": "공연 도우미에서 일정을 변경했어요",
  "schedule.event_canceled": "일정을 취소했어요",
  "schedule.attendance_forced": "겹치는 일정을 사유를 남기고 배정했어요",
  "run_sheet.created": "진행표를 만들었어요",
  "run_sheet.generated": "진행표를 자동으로 만들었어요",
  "run_sheet.regenerated": "진행표를 다시 만들었어요",
  "run_sheet.revised": "진행표를 개정했어요",
  "run_sheet.locked": "진행표를 확정했어요",
  "run_sheet.completed": "진행표를 마쳤어요",
  "run_sheet.item_created": "진행표 항목을 추가했어요",
  "run_sheet.item_updated": "진행표 항목을 고쳤어요",
  "run_sheet.item_deleted": "진행표 항목을 지웠어요",
  "run_sheet.items_reordered": "진행표 순서를 바꿨어요",
  "checklist.status_changed": "체크리스트 상태를 바꿨어요",
  "checklist.item_created": "체크리스트 항목을 추가했어요",
  "checklist.item_updated": "체크리스트 항목을 고쳤어요",
  "checklist.item_deleted": "체크리스트 항목을 지웠어요",
  "checklist.assignments_updated": "체크리스트 담당을 바꿨어요",
  "admin.user.profile.update": "회원 정보를 수정했어요",
  "admin.user.password.set": "회원 비밀번호를 지정했어요",
  "admin.user.password.generate": "회원 임시 비밀번호를 발급했어요",
  "admin.organization.create": "조직을 만들었어요",
  "admin.organization.update": "조직 정보를 수정했어요",
  "admin.organization.status": "조직 상태를 바꿨어요",
  "admin.system_setting.update": "시스템 설정을 바꿨어요",
  "admin.checklist_template.create": "체크리스트 양식을 만들었어요",
  "admin.checklist_template.update": "체크리스트 양식을 고쳤어요",
  "composition.imported": "대본으로 장·막 구성을 만들었어요",
  "section.created": "장·막을 추가했어요",
  "section.updated": "장·막 구성을 수정했어요",
  "section.archived": "장·막을 보관했어요",
  "section.restored": "장·막을 복원했어요",
  "section.sync.pull": "대본의 글로 구성 글을 맞췄어요",
  "section.sync.push": "구성의 글로 대본을 맞췄어요",
  "media.linked": "장면에 영상·자료를 연결했어요",
  "media.updated": "연결한 영상·자료를 바꿨어요",
  "media.unlinked": "연결한 영상·자료를 해제했어요",
  "inquiry.update": "공연 문의를 처리했어요",
  "admin.user.status": "회원 계정 상태를 바꿨어요",
  GUEST_READING_LINK_CREATED: "게스트 리딩 링크를 만들었어요",
  GUEST_READING_LINK_REVOKED: "게스트 리딩 링크를 닫았어요"
};

export const ENTITY_LABELS: Record<string, string> = {
  User: "회원", Production: "공연", Script: "대본", Scene: "장면", SceneBlock: "대본 줄", Membership: "참여자", Invitation: "초대",
  PerformanceSection: "장·막 구성", performance_composition: "장·막 구성", performance_section: "장·막", performance_media: "영상·자료", Inquiry_: "문의", TrackCue: "큐", Asset: "파일", Inquiry: "문의", ScheduleEvent: "일정", BoardPost: "게시글", RunSheet: "진행표", ChecklistItem: "체크리스트"
};

export function actionLabel(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action];
  if (action.startsWith("admin.user.status") || /status/.test(action)) return "상태를 바꿨어요";
  return action;
}
