import type { PageLoad } from "./$types";
import { loadFaq } from "$lib/api/site";
export const load: PageLoad = ({ fetch, depends }) => { depends("site:faq"); return loadFaq(fetch); };
