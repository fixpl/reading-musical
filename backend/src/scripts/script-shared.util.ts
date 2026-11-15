import { ConflictException } from "@nestjs/common";

export const VERSION_METADATA_SELECT = { id: true, label: true, createdAt: true, authorId: true } as const;

/** scripts 모듈 전체가 공유하는 작은 순수 유틸. */
export function anchorBrokenException(payload: { message: string; impact: unknown; canForce?: boolean }) {
  return new ConflictException({
    code: "ANCHOR_BROKEN",
    ...payload
  });
}
