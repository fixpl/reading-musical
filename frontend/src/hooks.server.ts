import { redirect, type Handle } from "@sveltejs/kit";

// 예전(개편 전) 주소로 들어온 링크(메일·북마크)를 지금 화면으로 보낸다. 새 화면이 있는 주소만 옮기고 나머지는 공연 홈으로 보낸다.
const SECTION: Record<string, string> = {
  script: "script", schedule: "schedule", members: "manage/members", casting: "manage/casting", settings: "manage/settings",
  people: "people", reading: "live", music: "cuesheet"
};

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const production = path.match(/^\/p\/([^/]+)(?:\/([^/]+))?/);
  if (production) {
    const section = production[2] ? SECTION[production[2]] : "";
    throw redirect(308, `/app/p/${production[1]}${section ? `/${section}` : ""}${event.url.search}`);
  }
  const moved: Record<string, string> = { "/productions": "/app", "/productions/new": "/admin/productions", "/notifications": "/app/notifications", "/settings": "/app/profile", "/schedule/me": "/app/schedule" };
  if (moved[path]) throw redirect(308, moved[path] + event.url.search);
  return resolve(event);
};
