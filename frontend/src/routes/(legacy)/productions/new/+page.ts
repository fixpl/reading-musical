import { redirect } from "@sveltejs/kit";

// 공연 등록은 운영 콘솔의 "새 공연" 다이얼로그로 이동했다.
export const load = () => {
  redirect(307, "/admin/productions");
};
