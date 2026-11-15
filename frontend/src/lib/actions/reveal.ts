// 스크롤해서 화면에 들어오면 부드럽게 나타나게 한다.
// - 최신 브라우저(scroll-driven animations): CSS(.sd-reveal)가 알아서 한다. 자바스크립트는 클래스만 붙인다.
// - 그 밖: IntersectionObserver로 같은 효과. 모션 줄이기 설정이면 처음부터 보이고, 스크립트가 없어도 내용은 보인다.
export function reveal(node: HTMLElement, options: { delay?: number } = {}) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return {};
  if (typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")) {
    node.classList.add("sd-reveal");
    return {};
  }
  if (!("IntersectionObserver" in window)) return {};
  const rect = node.getBoundingClientRect();
  // 이미 화면 안에 있는 요소는 숨기지 않는다(첫 화면이 깜빡이지 않도록).
  if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) return {};
  node.classList.add("reveal-pre");
  if (options.delay) node.style.transitionDelay = `${options.delay}ms`;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { node.classList.add("reveal-in"); observer.disconnect(); }
  }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
  observer.observe(node);
  return { destroy: () => observer.disconnect() };
}
