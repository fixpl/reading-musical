import { io } from "socket.io-client";
import { apiRequest, getAccessToken, getWsBaseUrl } from "./client";

export const COMMUNITY_CHANNELS = [
  { id: "GENERAL", label: "팀 대화", description: "공연팀과 소식, 질문을 나눠요." },
  { id: "REHEARSAL", label: "연습", description: "대본과 연습 시점에 연결된 의견을 모아요." },
  { id: "TECH", label: "무대 · 기술", description: "음향, 조명, 동선과 준비 사항을 확인해요." },
  { id: "NOTICE", label: "공지", description: "제작진이 전달하는 중요한 안내예요." },
  { id: "MATERIAL", label: "자료", description: "악보와 참고 자료의 링크를 함께 보관해요." }
] as const;
export type CommunityChannel = typeof COMMUNITY_CHANNELS[number]["id"];
export type CommunityAuthor = { id: string; name: string; profileType?: string };
export type CommunityComment = { id: string; body: string; createdAt: string; author: CommunityAuthor };
export type CommunityPost = {
  id: string; productionId: string; category: "NOTICE" | "QUESTION" | "MATERIAL";
  channel: CommunityChannel; visibility: "TEAM" | "PRIVATE"; status: "OPEN" | "RESOLVED";
  title: string; body: string; pinned: boolean; createdAt: string; updatedAt: string; revision: number;
  author: CommunityAuthor; _count?: { comments: number }; comments?: CommunityComment[];
  source: string | null; unitKey: string | null; positionMs: number | null; contextLabel: string | null;
};
export type CommunityPage = { items: CommunityPost[]; nextCursor: string | null };
export type MemoAnchor = { source: string; unitKey: string; positionMs: number; contextLabel: string };

export function listCommunity(pid: string, query: Record<string, string> = {}, signal?: AbortSignal) {
  return apiRequest<CommunityPage>(`/productions/${pid}/board?${new URLSearchParams(query)}`, { signal });
}
export function getCommunityPost(pid: string, postId: string, signal?: AbortSignal) {
  return apiRequest<CommunityPost>(`/productions/${pid}/board/${postId}`, { signal });
}
export function createCommunityPost(pid: string, input: { body: string; title?: string; channel: CommunityChannel; visibility: "TEAM" | "PRIVATE" } & Partial<MemoAnchor>) {
  return apiRequest<CommunityPost>(`/productions/${pid}/board`, { method: "POST", body: JSON.stringify(input) });
}
export function updateCommunityPost(pid: string, post: CommunityPost, input: { body?: string; title?: string; visibility?: "TEAM" | "PRIVATE"; status?: "OPEN" | "RESOLVED"; pinned?: boolean }) {
  return apiRequest<CommunityPost>(`/productions/${pid}/board/${post.id}`, { method: "PATCH", body: JSON.stringify({ ...input, expectedRevision: post.revision }) });
}
export function rehearsalLink(pid: string, post: CommunityPost) {
  const query = new URLSearchParams({ source: post.source ?? "composition", at: String(post.positionMs ?? 0), memo: post.id });
  return `/app/p/${pid}/live?${query}`;
}

// Each view owns and disconnects its socket. All payloads are invalidations;
// text is fetched through the API's current membership and private-note rules.
export function watchCommunity(pid: string, onchange: (postId?: string) => void, onconnection: (connected: boolean) => void = () => {}) {
  const socket = io(getWsBaseUrl(), { auth: (callback) => callback({ token: getAccessToken() }), autoConnect: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingPostId: string | undefined;
  const refresh = (postId?: string) => {
    // A burst involving multiple topics must also refresh an open earlier topic.
    pendingPostId = timer !== undefined && pendingPostId !== postId ? undefined : postId;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const changedId = pendingPostId;
      pendingPostId = undefined;
      onchange(changedId);
    }, 150);
  };
  socket.on("connect", () => { onconnection(true); refresh(); });
  socket.on("disconnect", () => onconnection(false));
  socket.on("connect_error", () => onconnection(false));
  socket.on("board.changed", (event: { productionId: string; postId: string }) => { if (event.productionId === pid) refresh(event.postId); });
  socket.connect();
  const onFocus = () => { refresh(); if (!socket.connected) socket.connect(); };
  const onVisible = () => { if (!document.hidden) onFocus(); };
  const poll = setInterval(() => { if (!document.hidden && !socket.connected) onFocus(); }, 20_000);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearTimeout(timer); clearInterval(poll); socket.disconnect();
    window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible);
  };
}
