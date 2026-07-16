import { redirect } from "@sveltejs/kit";

// 프로필 관리(직군 상세·사진 포함)는 새 프로필 화면으로 통합됐다.
export const load = () => {
  redirect(307, "/app/profile");
};
