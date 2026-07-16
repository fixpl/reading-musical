import { redirect } from "@sveltejs/kit";

// 리딩룸은 새 진행 모드로 대체됐다.
export const load = ({ params }: { params: { pid: string } }) => {
  redirect(307, `/app/p/${params.pid}/cuesheet`);
};
