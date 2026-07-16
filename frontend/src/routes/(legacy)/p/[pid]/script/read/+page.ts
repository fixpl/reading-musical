import { redirect } from "@sveltejs/kit";

// 구 대본 보기 화면은 새 워크스페이스 대본 화면으로 이동한다.
export const load = ({ params }: { params: { pid: string } }) => {
  redirect(307, `/app/p/${params.pid}/script`);
};
