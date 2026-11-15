import { apiRequest, uploadSignedObject } from "$lib/api/client";
import type { CompositionBoard, MediaSlot } from "$lib/domain/composition";
import { mimeFor } from "$lib/domain/video-match";
import { assertCurrentSession, captureSession, type ClientSession } from "$lib/api/session";

/** 파일을 올리고(저장소에 직접 업로드) 자료 id를 돌려준다. */
export async function uploadMediaFile(pid: string, file: File, session: ClientSession = captureSession()): Promise<{ assetId: string; mime: string }> {
  assertCurrentSession(session);
  const mime = mimeFor(file);
  const created = await apiRequest<{ asset: { id: string }; upload: { url: string; method?: string } }>("/assets", {
    method: "POST", session, body: JSON.stringify({ purpose: "CUE_MEDIA", productionId: pid, fileName: file.name, mimeType: mime, size: file.size })
  });
  assertCurrentSession(session);
  await uploadSignedObject(created.upload, file, mime, { session });
  assertCurrentSession(session);
  return { assetId: created.asset.id, mime };
}

export const slotForMime = (mime: string): Exclude<MediaSlot, "SOURCE" | "SCORE"> => (mime.startsWith("audio/") ? "MUSIC" : "BACKGROUND");

/**
 * 올린 자료를 장면에 연결한다. 같은 종류가 이미 있으면 새 파일로 교체하고, 없으면 새로 붙인다.
 * 앞선 연결이 구성 개정 번호를 올리므로 저장 직전에 최신 구성을 읽는다.
 */
export async function linkMedia(pid: string, sectionId: string, assetId: string, slot: MediaSlot, label: string, session: ClientSession = captureSession()): Promise<string> {
  assertCurrentSession(session);
  const base = `/productions/${pid}/composition`;
  const board = await apiRequest<CompositionBoard>(base, { session });
  assertCurrentSession(session);
  const section = board.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error("장면을 찾을 수 없어요. 구성을 새로고침해 주세요.");
  const existing = section.media.find((media) => media.slot === slot);
  const body = { expectedRevision: board.revision, assetId, slot, label };
  if (existing) {
    await apiRequest(`${base}/sections/${section.id}/media/${existing.id}`, { method: "PATCH", session, body: JSON.stringify(body) });
  } else {
    await apiRequest(`${base}/sections/${section.id}/media`, {
      method: "POST", session, body: JSON.stringify({ ...body, loop: slot !== "SCORE", volume: slot === "BACKGROUND" ? 0 : slot === "MUSIC" ? 0.6 : 1, ...(section.timing.durationMs && slot !== "SCORE" ? { durationMs: section.timing.durationMs } : {}) })
    });
  }
  assertCurrentSession(session);
  return section.title;
}
