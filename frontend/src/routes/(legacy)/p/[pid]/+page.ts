import { redirect } from "@sveltejs/kit";

// 구 화면은 새 워크스페이스로 이동한다.
export const load = ({ params }: { params: { pid: string } }) => {
  redirect(307, `/app/p/${params.pid}`);
};
