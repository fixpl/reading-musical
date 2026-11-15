import { BadRequestException } from "@nestjs/common";
import type { RoundDocumentDto } from "./dto";

/** 모집 입력만 정규화한다. 권한·revision·게시 가능 여부는 트랜잭션 안에서 검사한다. */
export function normalizeRecruitmentDocument(dto: RoundDocumentDto) {
  if (!dto || typeof dto !== "object") throw new BadRequestException("모집 내용을 확인해 주세요");
  const start = recruitmentDate(dto.activityStartDate), end = recruitmentDate(dto.activityEndDate);
  if (start && end && end < start) throw new BadRequestException("활동 종료일은 시작일보다 빠를 수 없어요");
  let deadlineAt: Date | null = null;
  if (dto.deadlineAt !== null && dto.deadlineAt !== undefined && dto.deadlineAt !== "") {
    if (typeof dto.deadlineAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(dto.deadlineAt)) throw new BadRequestException("지원 마감 시각을 시간대가 포함된 시각으로 입력해 주세요");
    recruitmentDate(dto.deadlineAt.slice(0, 10));
    const clock = dto.deadlineAt.slice(11, 19).split(":").map(Number);
    if (clock[0] > 23 || clock[1] > 59 || clock[2] > 59) throw new BadRequestException("실제 지원 마감 시각을 확인해 주세요");
    deadlineAt = new Date(dto.deadlineAt);
    if (Number.isNaN(deadlineAt.getTime())) throw new BadRequestException("지원 마감 시각을 확인해 주세요");
  }
  if (!Array.isArray(dto.positions) || dto.positions.length < 1 || dto.positions.length > 20) throw new BadRequestException("모집 자리는 1개 이상 20개 이하로 등록해 주세요");
  const positions = dto.positions.map((position, order) => {
    if (!position || !["ACTOR", "STAFF"].includes(position.role) || !Number.isInteger(position.capacity) || position.capacity < 1 || position.capacity > 1000) throw new BadRequestException("모집 역할과 정원을 확인해 주세요");
    return { role: position.role, label: recruitmentText(position.label, 100, "모집 자리 이름", true), capacity: position.capacity, order };
  });
  return { fields: {
    title: recruitmentText(dto.title, 120, "모집 제목", true), summary: recruitmentText(dto.summary, 200, "한 줄 소개"),
    description: recruitmentText(dto.description, 5000, "모집 설명"), region: recruitmentText(dto.region, 120, "활동 지역"),
    conditions: recruitmentText(dto.conditions, 2000, "참여 조건"), activityStartDate: start, activityEndDate: end, deadlineAt
  }, positions };
}

export function recruitmentText(value: unknown, max: number, label: string, required = false) {
  if (typeof value !== "string") throw new BadRequestException(`${label}을 확인해 주세요`);
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > max || required && !text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new BadRequestException(`${label}은 ${required ? "1자 이상 " : ""}${max}자 이하로 입력해 주세요`);
  return text;
}

function recruitmentDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("활동 날짜를 연월일로 입력해 주세요");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("실제 활동 날짜를 확인해 주세요");
  return date;
}
