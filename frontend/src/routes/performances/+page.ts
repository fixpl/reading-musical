import type { PageLoad } from "./$types";
import { loadPublicPerformances, todayInSeoul, type PublicPerformance } from "$lib/api/showcase";

export const load: PageLoad = async ({ fetch, depends, setHeaders }) => {
  depends("showcase:public");
  setHeaders({ "cache-control": "no-store" });
  try {
    const result = await loadPublicPerformances(fetch, 60);
    return { performances: result.items, performancesError: "", total: result.total, hasMore: result.hasMore, offset: result.offset, today: todayInSeoul() };
  } catch {
    return { performances: [] as PublicPerformance[], total: 0, hasMore: false, offset: 0, performancesError: "공연 소식을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.", today: todayInSeoul() };
  }
};
