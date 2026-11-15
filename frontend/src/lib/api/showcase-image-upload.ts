import { ApiError, apiRequest, uploadSignedObject, type SignedObjectRequest } from "$lib/api/client";
import { fileSha256Checksum } from "$lib/api/checksum";
import { assertCurrentSession, captureSession, type ClientSession } from "$lib/api/session";
import type { ShowcaseDocument } from "$lib/api/showcase";

export type PendingShowcaseImage = {
  id: string;
  file: File;
  mimeType: string;
  previewUrl: string;
  session: ClientSession;
  ticket?: { asset: { id: string }; upload: SignedObjectRequest };
  uploadedAssetId?: string;
  productionId?: string;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const mimeByExtension: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const inFlight = new WeakMap<PendingShowcaseImage, Promise<string>>();

function assertSession(session: ClientSession) {
  assertCurrentSession(session);
  if (session.signal.aborted) throw new DOMException("이미지 등록을 중단했어요.", "AbortError");
  if (!session.owner) throw new DOMException("로그인한 뒤 이미지를 다시 선택해 주세요.", "AbortError");
}

function imageMime(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = mimeByExtension[extension];
  if (!mimeType || (file.type && file.type !== "application/octet-stream" && file.type !== mimeType)
    || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("10MB 이하의 PNG·JPEG·WebP 이미지를 선택해 주세요.");
  }
  return mimeType;
}

/** 선택 단계에서는 메타데이터만 검사하고 브라우저 안에 미리보기를 만든다. */
export function createPendingShowcaseImage(file: File, session = captureSession()): PendingShowcaseImage {
  assertSession(session);
  const mimeType = imageMime(file);
  return { id: `local:${crypto.randomUUID()}`, file, mimeType, previewUrl: URL.createObjectURL(file), session };
}

export function revokePendingShowcaseImage(item: PendingShowcaseImage) {
  URL.revokeObjectURL(item.previewUrl);
}

function assertImage(item: PendingShowcaseImage, productionId: string, session: ClientSession) {
  assertSession(session);
  assertSession(item.session);
  if (item.session.owner !== session.owner || item.session.generation !== session.generation) {
    throw new DOMException("로그인 계정이 변경됐어요. 이미지를 다시 선택해 주세요.", "AbortError");
  }
  if (item.productionId && item.productionId !== productionId) {
    throw new DOMException("다른 공연에서 선택한 이미지는 사용할 수 없어요. 이미지를 다시 선택해 주세요.", "AbortError");
  }
}

async function boundedRequest<T>(session: ClientSession, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(timeout.signal);
  } catch (error) {
    assertSession(session);
    if (timeout.signal.aborted) throw new Error("이미지 전송 시간이 길어 중단했어요. 선택한 이미지는 남아 있으니 다시 저장해 주세요.");
    throw error;
  } finally { clearTimeout(timer); }
}

function ticketExpired(upload: SignedObjectRequest) {
  const expiresAt = (upload as SignedObjectRequest & { expiresAt?: string }).expiresAt;
  return typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now();
}

async function uploadImage(item: PendingShowcaseImage, productionId: string, session: ClientSession): Promise<string> {
  assertImage(item, productionId, session);
  if (item.uploadedAssetId) return item.uploadedAssetId;
  const active = inFlight.get(item);
  if (active) {
    const assetId = await active;
    assertImage(item, productionId, session);
    return assetId;
  }

  item.productionId = productionId;
  const work = (async () => {
    // 중단·네트워크 실패는 같은 예약을 재사용한다. 서버 만료 시각이 지난 예약만 교체한다.
    if (item.ticket && ticketExpired(item.ticket.upload)) item.ticket = undefined;
    if (!item.ticket) {
      const checksum = await fileSha256Checksum(item.file);
      assertImage(item, productionId, session);
      const ticket = await boundedRequest(session, (signal) => apiRequest<NonNullable<PendingShowcaseImage["ticket"]>>("/assets", {
        method: "POST", session, signal,
        body: JSON.stringify({ purpose: "SHOWCASE_IMAGE", productionId, fileName: item.file.name,
          mimeType: item.mimeType, size: item.file.size, checksum })
      }));
      assertImage(item, productionId, session);
      item.ticket = ticket;
    }
    try {
      await boundedRequest(session, (signal) => uploadSignedObject(item.ticket!.upload, item.file, item.mimeType, { session, signal }));
    } catch (error) {
      // 401·403만으로 재예약하면 권한 오류가 새 파일 예약으로 증폭되므로 기존 예약을 보존한다.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        throw new Error("이미지를 올릴 수 없어요. 다시 저장해도 같으면 관리자에게 파일 저장소 권한을 확인해 달라고 요청해 주세요.");
      }
      throw error;
    }
    assertImage(item, productionId, session);
    item.uploadedAssetId = item.ticket.asset.id;
    return item.uploadedAssetId;
  })();
  inFlight.set(item, work);
  try { return await work; }
  finally { if (inFlight.get(item) === work) inFlight.delete(item); }
}

/** 모든 전송이 끝난 뒤 반환할 문서만 치환한다. blob URL의 수명은 호출 화면이 관리한다. */
export async function uploadPendingShowcaseImages(
  productionId: string,
  document: ShowcaseDocument,
  pending: Record<string, PendingShowcaseImage>,
  session: ClientSession,
  onProgress?: (completed: number, total: number) => void
): Promise<ShowcaseDocument> {
  assertSession(session);
  if (!productionId.trim()) throw new Error("공연을 먼저 등록해 주세요.");
  if (document.gallery.length > 8) throw new Error("홍보 사진은 8장까지 등록할 수 있어요.");
  const copy = { ...document, gallery: document.gallery.map((item) => ({ ...item })) };
  const ids = [...new Set([copy.posterAssetId, ...copy.gallery.map((item) => item.assetId)]
    .filter((id): id is string => Boolean(id?.startsWith("local:"))))];
  const images = ids.map((id) => {
    const item = pending[id];
    if (!item || item.id !== id) throw new Error("선택한 이미지를 찾을 수 없어요. 이미지를 다시 선택해 주세요.");
    assertImage(item, productionId, session);
    imageMime(item.file);
    return item;
  });

  const replacements = new Map<string, string>();
  onProgress?.(0, images.length);
  for (const item of images) {
    assertImage(item, productionId, session);
    const assetId = await uploadImage(item, productionId, session);
    assertImage(item, productionId, session);
    replacements.set(item.id, assetId);
    onProgress?.(replacements.size, images.length);
  }
  assertSession(session);
  return { ...copy, posterAssetId: copy.posterAssetId ? replacements.get(copy.posterAssetId) ?? copy.posterAssetId : null,
    gallery: copy.gallery.map((item) => ({ ...item, assetId: replacements.get(item.assetId) ?? item.assetId })) };
}
