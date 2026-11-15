import { apiRequest, uploadSignedObject } from "./client";
import { referenceFileMetadata } from "$lib/domain/composition-attachments";
import type { MediaAsset } from "$lib/domain/composition";
import { assertCurrentSession, captureSession, type ClientSession } from "./session";

export type ReferenceUploadTicket = {
  asset: MediaAsset;
  upload: { url: string; method: string; expiresAt: string };
  session: ClientSession;
};
export async function reserveReferenceUpload(productionId: string, file: File, session: ClientSession = captureSession()): Promise<ReferenceUploadTicket> {
  assertCurrentSession(session);
  const metadata = referenceFileMetadata(file);
  const ticket = await apiRequest<Omit<ReferenceUploadTicket, "session">>("/assets", {
    method: "POST", session, body: JSON.stringify({ productionId, purpose: "PERFORMANCE_MATERIAL", ...metadata })
  });
  assertCurrentSession(session);
  return { ...ticket, session };
}
export async function transferReferenceFile(ticket: ReferenceUploadTicket, file: File, session: ClientSession = ticket.session): Promise<MediaAsset> {
  assertCurrentSession(ticket.session);
  assertCurrentSession(session);
  const metadata = referenceFileMetadata(file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    // 서명 주소로의 업로드는 쿠키·토큰 없이 보낸다(uploadSignedObject가 처리).
    await uploadSignedObject(ticket.upload, file, metadata.mimeType, { session, signal: controller.signal });
    assertCurrentSession(session);
    return ticket.asset;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("업로드 시간이 초과됐어요. 연결 상태를 확인하고 다시 시도해 주세요.");
    throw error;
  } finally { clearTimeout(timer); }
}
