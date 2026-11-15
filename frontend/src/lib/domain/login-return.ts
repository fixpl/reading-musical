// Never accept absolute URLs, protocol-relative URLs or ambiguous encoded path separators.
// This is a navigation convenience, not a substitute for server authorization.
export function safeLoginReturn(value: string | null | undefined): string | null {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://login-return.invalid");
    if (url.origin !== "https://login-return.invalid" || /%(?:2f|5c|00)/i.test(url.pathname)) return null;
    if (!(url.pathname === "/app" || url.pathname.startsWith("/app/") || url.pathname === "/support" || url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}
