export const ACCESS_TOKEN_KEY = "reading-musical.accessToken";

export type ClientSession = Readonly<{
  owner: string | null;
  generation: number;
  credentialGeneration: number;
  token: string | null;
  signal: AbortSignal;
}>;

let controller = new AbortController();
let current: ClientSession = { owner: null, generation: 0, credentialGeneration: 0, token: null, signal: controller.signal };
const listeners = new Set<(session: ClientSession) => void>();

function storedToken() {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(ACCESS_TOKEN_KEY); }
  catch { return null; }
}

function tokenOwner(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(part));
    return typeof payload === "object" && payload !== null && "sub" in payload && typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch { return null; }
}

/** JWT sub는 화면 상태의 분리에만 사용한다. 접근 권한은 서버가 검증한다. */
export function captureSession(): ClientSession {
  const token = storedToken();
  if (token === current.token) return current;
  const owner = tokenOwner(token);
  const changed = owner !== current.owner || owner === null;
  if (changed) controller.abort();
  if (changed) controller = new AbortController();
  current = Object.freeze({ owner, token, generation: current.generation + Number(changed), credentialGeneration: current.credentialGeneration + 1, signal: controller.signal });
  if (changed) for (const listener of [...listeners]) listener(current);
  return current;
}

export function isCurrentSession(session: ClientSession, credentials = false) {
  const latest = captureSession();
  return session.generation === latest.generation && session.owner === latest.owner && (!credentials || session.credentialGeneration === latest.credentialGeneration);
}

export function assertCurrentSession(session: ClientSession, credentials = false) {
  if (!isCurrentSession(session, credentials)) throw new DOMException("로그인 계정이 변경됐어요. 현재 계정에서 다시 열어 주세요.", "AbortError");
}

export function tokenBelongsToSession(session: ClientSession, token: string) {
  return session.owner !== null && tokenOwner(token) === session.owner;
}

export function subscribeSession(listener: (session: ClientSession) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 다른 탭의 계정 전환과 bfcache 복귀에서도 기존 화면의 owner를 폐기한다. */
export function watchSession() {
  const sync = () => { captureSession(); };
  const storage = (event: StorageEvent) => { if (event.key === null || event.key === ACCESS_TOKEN_KEY) sync(); };
  window.addEventListener("storage", storage);
  window.addEventListener("focus", sync);
  window.addEventListener("pageshow", sync);
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", sync);
    window.removeEventListener("pageshow", sync);
    document.removeEventListener("visibilitychange", sync);
  };
}

export function sessionRequestSignal(session: ClientSession, signal?: AbortSignal | null) {
  assertCurrentSession(session);
  const request = new AbortController();
  const abort = () => request.abort();
  const sources = [session.signal, signal].filter((item): item is AbortSignal => Boolean(item));
  for (const source of sources) {
    if (source.aborted) request.abort();
    else source.addEventListener("abort", abort, { once: true });
  }
  return { signal: request.signal, dispose: () => { for (const source of sources) source.removeEventListener("abort", abort); } };
}
