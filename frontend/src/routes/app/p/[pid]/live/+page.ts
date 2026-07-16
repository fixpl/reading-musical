import { redirect } from "@sveltejs/kit";

// 진행 모드는 큐시트 타임라인의 "진행 시작" 버튼으로 통합됐다.
export const load = ({ params }: { params: { pid: string } }) => {
  redirect(307, `/app/p/${params.pid}/cuesheet`);
};
