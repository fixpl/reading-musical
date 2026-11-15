export const ADMIN_SITE_LINKS = [
  { href: "/admin/settings", label: "사이트·약관 설정" },
  { href: "/admin/faq", label: "자주 묻는 질문 관리" },
  { href: "/admin/support", label: "고객센터 문의" }
] as const;

export function isAdminPath(pathname: string, target: string, exact = false): boolean {
  return pathname === target || (!exact && pathname.startsWith(`${target}/`));
}
export function settingsTab(search: string): "site" | "policy" {
  return new URLSearchParams(search).get("tab") === "policy" ? "policy" : "site";
}
export function settingsTabHref(search: string, value: string): string {
  const params = new URLSearchParams(search);
  params.set("tab", value === "policy" ? "policy" : "site");
  return `/admin/settings?${params}`;
}
