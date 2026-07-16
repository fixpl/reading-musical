import { Phase, ProductionRole, StaffDiscipline } from "@prisma/client";

export type DefaultChecklistItem = {
  label: string;
  description?: string;
  assigneeRole?: ProductionRole;
  staffDiscipline?: StaffDiscipline;
  requiresApproval?: boolean;
};

export const DEFAULT_CHECKLIST: Record<Phase, DefaultChecklistItem[]> = {
  [Phase.PLANNING]: [
    {
      label: "공연 기본 정보 확정",
      description: "공연명, 장소, 기간, 공개 상태를 운영자가 확인한다.",
      assigneeRole: ProductionRole.PRODUCER
    },
    {
      label: "대본 초안 등록",
      description: "대본을 직접 입력하거나 파일 import draft를 검수해 장면/블록으로 반영한다.",
      assigneeRole: ProductionRole.DIRECTOR,
      requiresApproval: true
    }
  ],
  [Phase.READING]: [
    {
      label: "리딩 일정 생성 및 참석자 초대",
      description: "리딩 일정, 장면, 큐, 참석 대상자를 연결하고 출석 응답을 받는다.",
      assigneeRole: ProductionRole.PRODUCER
    },
    {
      label: "배역 매칭 확인",
      description: "주요 배역과 배우 멤버가 연결되어 있는지 확인한다.",
      assigneeRole: ProductionRole.DIRECTOR
    },
    {
      label: "음악 큐 anchor 확인",
      description: "큐시트의 장면/대본 블록 연결 상태가 OK인지 확인한다.",
      assigneeRole: ProductionRole.MUSIC_DIRECTOR,
      requiresApproval: true
    }
  ],
  [Phase.REHEARSAL]: [
    {
      label: "무대 세팅 메모 확인",
      description: "장면별 무대 배치와 세팅 메모를 작성하고 스태프가 확인한다.",
      assigneeRole: ProductionRole.STAGE_MANAGER,
      staffDiscipline: StaffDiscipline.STAGE_CREW,
      requiresApproval: true
    },
    {
      label: "스태프 직무별 준비물 점검",
      description: "음향, 조명, 소품, 의상, 영상 등 세부 직무별 준비 항목을 완료한다.",
      assigneeRole: ProductionRole.STAFF,
      requiresApproval: true
    }
  ],
  [Phase.PERFORMANCE]: [
    {
      label: "최종 진행표 잠금",
      description: "일정, 장면, 큐, 세팅 메모, 체크 항목을 반영한 진행표를 잠근다.",
      assigneeRole: ProductionRole.STAGE_MANAGER,
      requiresApproval: true
    },
    {
      label: "공개 전 필수 조건 확인",
      description: "대본 확정, 역할 매칭, 큐 anchor, 일정/출석, 진행표, 필수 체크 항목을 최종 확인한다.",
      assigneeRole: ProductionRole.PRODUCER,
      requiresApproval: true
    }
  ]
};

export function defaultChecklistItemsForPhase(phase: Phase) {
  return DEFAULT_CHECKLIST[phase].map((item, index) => ({
    order: index + 1,
    label: item.label,
    description: item.description,
    assigneeRole: item.assigneeRole,
    staffDiscipline: item.staffDiscipline,
    requiresApproval: item.requiresApproval ?? false
  }));
}
