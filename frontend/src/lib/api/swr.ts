import { assertCurrentSession, captureSession, isCurrentSession, subscribeSession, type ClientSession } from "./session";

// 캐시와 비동기 쓰기를 요청을 시작한 계정에 묶는다. 계정 전환 후 도착한 값은 다시 저장하지 않는다.
const store = new Map<string, { session: ClientSession; value: unknown }>();
subscribeSession(() => store.clear());

export function peek<T>(key: string): T | undefined {
  captureSession();
  const entry = store.get(key);
  return entry && isCurrentSession(entry.session) ? entry.value as T : undefined;
}

export function remember<T>(key: string, value: T, session: ClientSession): T {
  assertCurrentSession(session);
  store.set(key, { session, value });
  return value;
}

export function clearSwr() {
  store.clear();
}
