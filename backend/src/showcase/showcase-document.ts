import { BadRequestException } from "@nestjs/common";
import type { ShowcaseDocument } from "./dto";

/** 공개 문서 필드를 한정한다. 사진 소유권·실제 본문·동의는 서비스에서 다시 검사한다. */
export function normalizeShowcaseDocument(value: unknown): ShowcaseDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("공연 소개 내용을 확인해 주세요");
  const row = value as Record<string, unknown>;
  const startDate = showcaseDate(row.startDate); const endDate = showcaseDate(row.endDate);
  if (startDate && endDate && endDate < startDate) throw new BadRequestException("종료일은 시작일보다 빠를 수 없어요");
  if (!Array.isArray(row.gallery) || row.gallery.length > 8) throw new BadRequestException("홍보 사진은 최대 8장까지 등록할 수 있어요");
  const gallery = row.gallery.map((image: unknown) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) throw new BadRequestException("홍보 사진을 확인해 주세요");
    const entry = image as Record<string, unknown>;
    return { assetId: imageId(entry.assetId), caption: showcaseText(entry.caption, 200, "사진 설명") };
  });
  if (new Set(gallery.map((entry) => entry.assetId)).size !== gallery.length) throw new BadRequestException("같은 홍보 사진을 중복 등록할 수 없어요");
  return { title: showcaseText(row.title, 120, "공연 제목", true), synopsis: showcaseText(row.synopsis, 200, "한 줄 소개"),
    description: showcaseText(row.description, 10000, "공연 설명"), venue: showcaseText(row.venue, 200, "장소"),
    startDate, endDate, posterAssetId: row.posterAssetId === null || row.posterAssetId === undefined ? null : imageId(row.posterAssetId),
    officialUrl: showcaseUrl(row.officialUrl), ticketUrl: showcaseUrl(row.ticketUrl), videoUrl: showcaseUrl(row.videoUrl), gallery };
}

export function showcaseText(value: unknown, max: number, label: string, required = false) {
  if (typeof value !== "string") throw new BadRequestException(`${label}을 확인해 주세요`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized.length > max || (required && !normalized)) throw new BadRequestException(`${label}은 ${required ? "1자 이상 " : ""}${max}자 이하로 입력해 주세요`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) throw new BadRequestException(`${label}에 사용할 수 없는 문자가 있어요`);
  return normalized;
}

function showcaseDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("공연 날짜는 연월일로 입력해 주세요");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("실제 공연 날짜를 확인해 주세요");
  return value;
}

function showcaseUrl(value: unknown) {
  const text = showcaseText(value, 2048, "주소");
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error("invalid");
    return url.href;
  } catch { throw new BadRequestException("https://로 시작하는 공개 주소를 입력해 주세요"); }
}

function imageId(id: unknown): string {
  if (typeof id !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) throw new BadRequestException("사진 파일을 다시 선택해 주세요");
  return id;
}
