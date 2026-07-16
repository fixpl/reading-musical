import { redirect } from "@sveltejs/kit";

// 편집 도구는 새 워크스페이스의 제작 관리로 이동했다.
export const load = ({ params }: { params: { pid: string } }) => {
  redirect(307, `/app/p/${params.pid}/manage/members`);
};
