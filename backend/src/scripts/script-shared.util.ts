import { ConflictException } from "@nestjs/common";

/** scripts 모듈 전체가 공유하는 작은 순수 유틸. */
export function anchorBrokenException(payload: { message: string; impact: unknown; canForce?: boolean }) {
  return new ConflictException({
    code: "ANCHOR_BROKEN",
    ...payload
  });
}
