/// <reference lib="webworker" />
import { build, files, version } from "$service-worker";

// 앱 껍데기(빌드 파일·정적 파일)만 저장해 빨리 열고, 데이터(API)는 항상 서버에서 받는다.
// 로그인 정보·공연 데이터·서명된 파일 주소는 저장하지 않는다.
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `artbridge-shell-${version}`;
const SHELL = [...build, ...files.filter((file) => !file.endsWith(".webmanifest"))];

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => sw.clients.claim()));
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return; // API(다른 주소)·파일 저장소는 건드리지 않는다.
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
    return;
  }
  // 화면 이동: 서버가 안 되면 오프라인 안내를 보여 준다.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/offline.html")) ?? Response.error()));
  }
});
