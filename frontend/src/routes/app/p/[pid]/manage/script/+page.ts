import { redirect } from "@sveltejs/kit";

// 대본 편집은 구성 화면의 "줄 편집"으로 합쳐졌다(대본 등록·줄 편집·구간 편집이 한 화면).
export const load = ({ params }: { params: { pid: string } }) => {
  redirect(307, `/app/p/${params.pid}/composition`);
};
