import { env } from "$env/dynamic/public";
import { canStoreRefreshToken } from "./refresh-token-policy";
import { ACCESS_TOKEN_KEY, assertCurrentSession, captureSession, isCurrentSession, sessionRequestSignal, tokenBelongsToSession, type ClientSession } from "./session";

const DEFAULT_API_BASE_URL = "/api/v1";
const STRICT_PUBLIC_APP_ENVS = new Set(["production", "prod", "staging"]);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export type AuthTokens = {
  accessToken: string;
  refreshToken?: string;
};

export type SignedObjectRequest = {
  url: string;
  method?: string;
};

export function getApiBaseUrl() {
  const configuredUrl = env.PUBLIC_API_BASE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }
  if (requiresExplicitPublicApiHost()) {
    throw new Error("PUBLIC_API_BASE_URL is required for production or staging frontend deployments.");
  }
  return DEFAULT_API_BASE_URL;
}

export function getWsBaseUrl() {
  const wsUrl = env.PUBLIC_WS_URL?.trim();
  if (wsUrl) {
    return normalizeWsUrl(wsUrl);
  }
  if (requiresExplicitPublicApiHost()) {
    throw new Error("PUBLIC_WS_URL is required for production or staging frontend deployments.");
  }
  const apiBaseUrl = getApiBaseUrl();
  if (/^https?:\/\//.test(apiBaseUrl)) {
    return normalizeWsUrl(apiBaseUrl.replace(/\/api\/v\d+\/?$/, ""));
  }
  return normalizeWsUrl(defaultClientOrigin());
}

export function saveTokens(tokens: AuthTokens, session?: ClientSession) {
  captureSession();
  if (session && (!isCurrentSession(session, true) || !tokenBelongsToSession(session, tokens.accessToken))) return false;
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  const shouldStoreRefreshToken = canStoreRefreshToken(env.PUBLIC_STORE_REFRESH_TOKEN, env.PUBLIC_APP_ENV);
  if (shouldStoreRefreshToken && tokens.refreshToken) {
    localStorage.setItem("reading-musical.refreshToken", tokens.refreshToken);
  } else {
    localStorage.removeItem("reading-musical.refreshToken");
  }
  captureSession();
  return true;
}

export function getAccessToken() {
  return captureSession().token;
}

export function getRefreshToken() {
  return localStorage.getItem("reading-musical.refreshToken");
}

export function clearTokens(session?: ClientSession, credentials = false) {
  captureSession();
  if (session && !isCurrentSession(session, credentials)) return false;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem("reading-musical.refreshToken");
  captureSession();
  return true;
}

type ErrorPayload = {
  message?: unknown;
  code?: unknown;
};

function extractErrorMessage(payload: unknown) {
  if (!(typeof payload === "object" && payload && "message" in payload)) {
    return "요청을 처리하지 못했어요";
  }
  const message = (payload as ErrorPayload).message;
  if (typeof message === "string") {
    return message;
  }
  if (typeof message === "object" && message && "message" in message && typeof (message as { message?: unknown }).message === "string") {
    return (message as { message: string }).message;
  }
  return "요청을 처리하지 못했어요";
}

function buildApiUrl(path: string) {
  return `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 게스트 전용 토큰은 JSON 본문으로만 보내고 회원 인증·cookie·자동 갱신을 섞지 않는다. */
export function anonymousJsonPost(path: string, body: unknown, init: { signal?: AbortSignal } = {}) {
  return fetch(buildApiUrl(path), {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: init.signal
  });
}

function requiresExplicitPublicApiHost() {
  return STRICT_PUBLIC_APP_ENVS.has((env.PUBLIC_APP_ENV || "").trim().toLowerCase());
}

function normalizeWsUrl(value: string) {
  const trimmed = value.replace(/\/+$/, "");
  if (typeof window === "undefined") {
    return trimmed || "/ws";
  }
  const parsed = new URL(trimmed || "/ws", window.location.origin);
  if (parsed.pathname === "" || parsed.pathname === "/") {
    parsed.pathname = "/ws";
  }
  return parsed.toString().replace(/\/+$/, "");
}

function defaultClientOrigin() {
  return typeof window === "undefined" ? "/ws" : window.location.origin;
}

async function parseResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

// 병렬 401이 같은 refresh token을 동시에 쓰면 서버가 재사용(탈취)으로 판단해 세션을 폐기한다.
// 갱신은 반드시 한 번만 날아가도록 single-flight로 묶는다.
let refreshInFlight: { session: ClientSession; promise: Promise<boolean> } | null = null;

function refreshAccessToken(session: ClientSession) {
  assertCurrentSession(session);
  if (!session.owner) return Promise.resolve(false);
  // 같은 계정의 다른 요청이 이미 갱신했다면 최신 token으로 한 번 재시도한다.
  if (!isCurrentSession(session, true)) return Promise.resolve(true);
  if (refreshInFlight && isCurrentSession(refreshInFlight.session, true)) return refreshInFlight.promise;
  const entry = { session, promise: Promise.resolve(false) };
  entry.promise = doRefreshAccessToken(session).finally(() => { if (refreshInFlight === entry) refreshInFlight = null; });
  refreshInFlight = entry;
  return entry.promise;
}

async function doRefreshAccessToken(session: ClientSession) {
  const refreshToken = typeof localStorage === "undefined" ? null : getRefreshToken();
  const csrfToken = refreshToken ? null : readCookie("reading_musical_csrf");
  const headers: HeadersInit = refreshToken ? { "content-type": "application/json" } : {};
  if (csrfToken) {
    headers["x-reading-musical-csrf"] = csrfToken;
  }
  const response = await fetch(buildApiUrl("/auth/refresh"), {
    method: "POST",
    credentials: "include",
    headers,
    body: refreshToken ? JSON.stringify({ refreshToken }) : undefined,
    signal: session.signal,
    cache: "no-store"
  });

  assertCurrentSession(session);
  if (!isCurrentSession(session, true)) return true;

  if (!response.ok) {
    clearTokens(session, true);
    return false;
  }

  const payload = (await parseResponsePayload(response)) as { tokens?: AuthTokens };
  assertCurrentSession(session);
  if (!isCurrentSession(session, true)) return true;
  // 지연 응답의 Set-Cookie가 다른 계정의 cookie를 남겨도 그 계정으로 자동 전환하지 않는다.
  if (!payload.tokens?.accessToken || !payload.tokens.refreshToken || !tokenBelongsToSession(session, payload.tokens.accessToken)) {
    clearTokens(session, true);
    return false;
  }

  return saveTokens(payload.tokens, session);
}

async function requestOnce(path: string, init: RequestInit, session: ClientSession) {
  assertCurrentSession(session);
  const headers = new Headers(init.headers);
  const token = typeof localStorage === "undefined" ? null : getAccessToken();

  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (token && path !== "/auth/login") {
    headers.set("authorization", `Bearer ${token}`);
  }

  return fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: init.credentials ?? "include"
  });
}

export type ApiRequestInit = RequestInit & { session?: ClientSession };

export async function apiRequest<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const { session = captureSession(), ...init } = options;
  const request = sessionRequestSignal(session, init.signal);
  try {
    let response = await requestOnce(path, { ...init, cache: init.cache ?? "no-store", signal: request.signal }, session);
    assertCurrentSession(session);

    if (response.status === 401 && path !== "/auth/login" && path !== "/auth/refresh" && path !== "/auth/logout" && (await refreshAccessToken(session))) {
      response = await requestOnce(path, { ...init, cache: init.cache ?? "no-store", signal: request.signal }, session);
    }

    const payload = await parseResponsePayload(response);
    assertCurrentSession(session);

    if (!response.ok) {
      const message = extractErrorMessage(payload);
      const code =
        typeof payload === "object" && payload && "code" in payload ? String((payload as ErrorPayload).code) : undefined;
      throw new ApiError(message, response.status, code, payload);
    }
    return payload as T;
  } finally { request.dispose(); }
}

// multipart 파일 업로드. FormData는 브라우저가 boundary를 붙이도록 content-type을 지정하지 않는다.
export async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const session = captureSession();
  const send = () => {
    assertCurrentSession(session);
    const token = typeof localStorage === "undefined" ? null : getAccessToken();
    const headers = new Headers();
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(buildApiUrl(path), { method: "POST", body: form, headers, credentials: "include", signal: session.signal, cache: "no-store" });
  };
  let response = await send();
  assertCurrentSession(session);
  if (response.status === 401 && (await refreshAccessToken(session))) {
    response = await send();
  }
  const payload = await parseResponsePayload(response);
  assertCurrentSession(session);
  if (!response.ok) {
    const message = extractErrorMessage(payload);
    const code =
      typeof payload === "object" && payload && "code" in payload ? String((payload as ErrorPayload).code) : undefined;
    throw new ApiError(message, response.status, code, payload);
  }
  return payload as T;
}

export type StreamEvent = { type: string; [key: string]: unknown };

// NDJSON 스트림 POST. 줄마다 JSON 이벤트를 onEvent로 넘긴다. 401이면 한 번 갱신 후 재시도.
export async function streamNdjson(
  path: string,
  jsonBody: unknown,
  onEvent: (event: StreamEvent) => void,
  init: { signal?: AbortSignal } = {}
): Promise<void> {
  const session = captureSession();
  const request = sessionRequestSignal(session, init.signal);
  const send = () => {
    assertCurrentSession(session);
    const token = typeof localStorage === "undefined" ? null : getAccessToken();
    const headers = new Headers({ "content-type": "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(buildApiUrl(path), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(jsonBody),
      signal: request.signal,
      cache: "no-store"
    });
  };
  try {
    let response = await send();
    assertCurrentSession(session);
    if (response.status === 401 && (await refreshAccessToken(session))) {
      response = await send();
    }
    if (!response.ok || !response.body) {
      const payload = await parseResponsePayload(response);
      assertCurrentSession(session);
      throw new ApiError(extractErrorMessage(payload), response.status, undefined, payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const flush = (chunk: string) => {
      assertCurrentSession(session);
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        assertCurrentSession(session);
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            onEvent(JSON.parse(line) as StreamEvent);
          } catch {
            // 불완전한 줄은 무시한다.
          }
        }
        newline = buffer.indexOf("\n");
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      assertCurrentSession(session);
      if (done) break;
      flush(decoder.decode(value, { stream: true }));
    }
    flush(decoder.decode());
    if (buffer.trim()) {
      assertCurrentSession(session);
      try {
        onEvent(JSON.parse(buffer.trim()) as StreamEvent);
      } catch {
        // 불완전한 마지막 줄은 무시한다.
      }
    }
  } finally { request.dispose(); }
}

export async function uploadSignedObject(upload: SignedObjectRequest, body: BodyInit, contentType?: string, init: { signal?: AbortSignal; session?: ClientSession } = {}) {
  const session = init.session ?? captureSession();
  const request = sessionRequestSignal(session, init.signal);
  const headers = new Headers();
  if (contentType) {
    headers.set("content-type", contentType);
  }
  let response: Response;
  try {
    response = await fetch(upload.url, {
      method: upload.method || "PUT",
      headers,
      body,
      credentials: "omit",
      signal: request.signal
    });
  } catch (failure) {
    if (failure instanceof DOMException && failure.name === "AbortError") throw failure;
    // 브라우저가 저장소에 닿지 못한 경우(대개 저장소의 허용 주소(CORS) 설정이 없거나 네트워크가 끊김).
    throw new ApiError("파일 저장소에 연결하지 못했어요. 네트워크를 확인하고, 계속되면 관리자에게 저장소 허용 주소(CORS) 설정을 확인해 달라고 요청해 주세요.", 0);
  } finally { request.dispose(); }
  assertCurrentSession(session);
  if (!response.ok) {
    throw new ApiError(`파일 업로드에 실패했어요. (${response.status})`, response.status);
  }
  return response;
}
