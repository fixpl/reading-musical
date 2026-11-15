import type { PublicSite } from "$lib/api/site";

declare global {
  namespace App {
    interface PageData {
      // The shared layout supplies these values, including its explicit failure state.
      site?: PublicSite | null;
      siteError?: string;
    }
  }
}

export {};
