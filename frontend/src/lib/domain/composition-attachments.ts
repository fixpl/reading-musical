import type { CompositionSection, MediaAsset } from "./composition";

export const REFERENCE_MAX_BYTES = 50 * 1024 * 1024;
export const REFERENCE_MAX_BATCH = 10;
export const REFERENCE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt";
const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain"
};

// File.type may be empty on mobile; canonicalize by the allowlisted extension.
export function referenceFileMetadata(file: { name: string; size: number }) {
  const name = file.name.trim();
  const extension = name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const mimeType = Object.prototype.hasOwnProperty.call(MIME, extension) ? MIME[extension] : undefined;
  if (!mimeType) throw new Error("참고 첨부는 PDF·PNG·JPG·WEBP·DOCX·TXT 파일을 지원합니다.");
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > REFERENCE_MAX_BYTES) throw new Error("빈 파일은 첨부할 수 없으며 파일당 최대 50MB까지 가능합니다.");
  return { fileName: file.name, mimeType, size: file.size };
}
export function isReferenceAsset(asset: Pick<MediaAsset, "mime" | "sizeBytes">) {
  return Object.values(MIME).includes(asset.mime) && asset.sizeBytes > 0 && asset.sizeBytes <= REFERENCE_MAX_BYTES;
}
export function referenceGroups(sections: CompositionSection[], section: CompositionSection) {
  const parent = sections.find((candidate) => candidate.id === section.parentId && candidate.parentId === null);
  return [section, ...(parent ? [parent] : [])].map((owner) => ({
    owner, inherited: owner.id !== section.id,
    files: owner.media.filter((media) => media.slot === "SOURCE").sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }));
}
export function fileSizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}
export function referenceUrls(rawUrl: string) {
  if (!/^(https?:\/\/|\/(?!\/))/i.test(rawUrl)) throw new Error("유효하지 않은 파일 주소입니다.");
  const relative = rawUrl.startsWith("/");
  const parsed = new URL(rawUrl, "https://relative.invalid");
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("유효하지 않은 파일 주소입니다.");
  const render = () => relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
  const open = render();
  parsed.searchParams.set("download", "1");
  return { open, download: render() };
}
