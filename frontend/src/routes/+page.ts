import type { PageLoad } from "./$types";
import { loadFaq } from "$lib/api/site";
import { loadPublicPerformances, todayInSeoul, type PublicPerformance } from "$lib/api/showcase";

export const load: PageLoad = async ({ fetch, depends, setHeaders }) => {
  depends("site:faq");
  depends("showcase:public");
  setHeaders({ "cache-control": "no-store" });
  const [faq, performances] = await Promise.all([
    loadFaq(fetch),
    loadPublicPerformances(fetch, 4)
      .then((result) => ({ performances: result.items, performancesError: "" }))
      .catch(() => ({ performances: [] as PublicPerformance[], performancesError: "공연 소식을 불러오지 못했어요." }))
  ]);
  return { ...faq, ...performances, today: todayInSeoul() };
};
