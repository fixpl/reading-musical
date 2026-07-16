import { env } from "$env/dynamic/public";
import { canStoreRefreshToken } from "./refresh-token-policy";

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

export function saveTokens(tokens: AuthTokens) {
  localStorage.setItem("reading-musical.accessToken", tokens.accessToken);
  const shouldStoreRefreshToken = canStoreRefreshToken(env.PUBLIC_STORE_REFRESH_TOKEN, env.PUBLIC_APP_ENV);
  if (shouldStoreRefreshToken && tokens.refreshToken) {
    localStorage.setItem("reading-musical.refreshToken", tokens.refreshToken);
  } else {
    localStorage.removeItem("reading-musical.refreshToken");
  }
}

export function getAccessToken() {
  return localStorage.getItem("reading-musical.accessToken");
}

export function getRefreshToken() {
  return localStorage.getItem("reading-musical.refreshToken");
}

export function clearTokens() {
  localStorage.removeItem("reading-musical.accessToken");
  localStorage.removeItem("reading-musical.refreshToken");
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
let refreshInFlight: Promise<boolean> | null = null;

function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = doRefreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefreshAccessToken() {
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
    body: refreshToken ? JSON.stringify({ refreshToken }) : undefined
  });

  if (!response.ok) {
    clearTokens();
    return false;
  }

  const payload = (await parseResponsePayload(response)) as { tokens?: AuthTokens };
  if (!payload.tokens?.accessToken || !payload.tokens.refreshToken) {
    clearTokens();
    return false;
  }

  saveTokens(payload.tokens);
  return true;
}

async function requestOnce(path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  const token = typeof localStorage === "undefined" ? null : getAccessToken();

  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: init.credentials ?? "include"
  });
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await requestOnce(path, init);

  if (response.status === 401 && path !== "/auth/refresh" && (await refreshAccessToken())) {
    response = await requestOnce(path, init);
  }

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    const message = extractErrorMessage(payload);
    const code =
      typeof payload === "object" && payload && "code" in payload ? String((payload as ErrorPayload).code) : undefined;
    throw new ApiError(message, response.status, code, payload);
  }

  return payload as T;
}

// multipart 파일 업로드. FormData는 브라우저가 boundary를 붙이도록 content-type을 지정하지 않는다.
export async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const send = () => {
    const token = typeof localStorage === "undefined" ? null : getAccessToken();
    const headers = new Headers();
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(buildApiUrl(path), { method: "POST", body: form, headers, credentials: "include" });
  };
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await send();
  }
  const payload = await parseResponsePayload(response);
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
  const send = () => {
    const token = typeof localStorage === "undefined" ? null : getAccessToken();
    const headers = new Headers({ "content-type": "application/json" });
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(buildApiUrl(path), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(jsonBody),
      signal: init.signal
    });
  };
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await send();
  }
  if (!response.ok || !response.body) {
    const payload = await parseResponsePayload(response);
    throw new ApiError(extractErrorMessage(payload), response.status, undefined, payload);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
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
    if (done) break;
    flush(decoder.decode(value, { stream: true }));
  }
  flush(decoder.decode());
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()) as StreamEvent);
    } catch {
      // ignore
    }
  }
}

export async function uploadSignedObject(upload: SignedObjectRequest, body: BodyInit, contentType?: string) {
  const headers = new Headers();
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const response = await fetch(upload.url, {
    method: upload.method || "PUT",
    headers,
    body,
    credentials: "omit"
  });
  if (!response.ok) {
    throw new ApiError(`파일 업로드에 실패했어요. (${response.status})`, response.status);
  }
  return response;
}
