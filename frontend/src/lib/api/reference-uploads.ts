import { apiRequest } from "./client";
import { referenceFileMetadata } from "$lib/domain/composition-attachments";
import type { MediaAsset } from "$lib/domain/composition";

export type ReferenceUploadTicket = {
  asset: MediaAsset;
  upload: { url: string; method: string; expiresAt: string };
};
export async function reserveReferenceUpload(productionId: string, file: File): Promise<ReferenceUploadTicket> {
  const metadata = referenceFileMetadata(file);
  return apiRequest<ReferenceUploadTicket>("/assets", {
    method: "POST", body: JSON.stringify({ productionId, purpose: "PERFORMANCE_MATERIAL", ...metadata })
  });
}
export async function transferReferenceFile(ticket: ReferenceUploadTicket, file: File): Promise<MediaAsset> {
  const metadata = referenceFileMetadata(file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    // Signed upload requests deliberately omit cookies and access tokens.
    const response = await fetch(ticket.upload.url, { method: ticket.upload.method || "PUT", credentials: "omit",
      headers: { "content-type": metadata.mimeType }, body: file, signal: controller.signal });
    if (!response.ok) throw new Error(`파일 업로드에 실패했습니다. (${response.status}) 다시 시도하세요.`);
    return ticket.asset;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("업로드 시간이 초과되었습니다. 연결을 확인하고 다시 시도하세요.");
    throw error;
  } finally { clearTimeout(timer); }
}
