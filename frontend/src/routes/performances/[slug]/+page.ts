import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { PublicApiError } from "$lib/api/site";
import { loadPublicPerformance, todayInSeoul } from "$lib/api/showcase";

export const load: PageLoad = async ({ params, fetch, depends, setHeaders }) => {
  depends("showcase:public");
  setHeaders({ "cache-control": "no-store" });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.slug)) {
    error(404, "공연 소개를 찾을 수 없어요. 주소를 다시 확인해 주세요.");
  }
  try {
    return { performance: await loadPublicPerformance(params.slug, fetch), today: todayInSeoul() };
  } catch (failure) {
    if (failure instanceof PublicApiError && (failure.status === 400 || failure.status === 404)) error(404, "공연 소개를 찾을 수 없어요. 공개가 끝났거나 주소가 변경되었을 수 있어요.");
    error(503, "공연 소개를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
  }
};
