import type { LayoutLoad } from "./$types";
import { publicRequest, type PublicSite } from "$lib/api/site";
export const load: LayoutLoad = async ({ fetch, depends }) => {
  depends("site:public");
  try { return { site: await publicRequest<PublicSite>("/site/public", fetch), siteError: "" }; }
  catch { return { site: null, siteError: "사이트 운영 정보를 불러오지 못했어요." }; }
};
