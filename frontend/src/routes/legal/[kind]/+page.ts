import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { POLICY_SLUGS, PublicApiError, publicRequest, type LegalDocument } from "$lib/api/site";

export const load: PageLoad = async ({ params, url, fetch, depends }) => {
  depends("site:policies");
  const kind = Object.entries(POLICY_SLUGS).find(([, slug]) => slug === params.kind)?.[0];
  if (!kind || url.searchParams.get("preview") === "1") error(404, "문서를 찾을 수 없어요.");
  const id = url.searchParams.get("id");
  try {
    const legal = await publicRequest<{ document: LegalDocument; history: Array<{ id: string; title: string; effectiveAt: string }> }>(`/site/policies/${kind}${id ? `?id=${encodeURIComponent(id)}` : ""}`, fetch);
    if (!legal.document.publishedAt) error(404, "문서를 찾을 수 없어요.");
    return { legal };
  } catch (failure) {
    if (failure instanceof PublicApiError && failure.status === 404) error(404, "문서를 찾을 수 없어요.");
    error(503, "문서를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
};
