import type { Preview } from "@storybook/sveltekit";
import "../src/app.css";

// 앱은 다크(나이트)가 기본 테마라서 툴바 기본값도 다크로 둬요.
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "테마",
      toolbar: {
        title: "테마",
        icon: "circlehollow",
        dynamicTitle: true,
        items: [
          { value: "dark", title: "다크", icon: "moon" },
          { value: "light", title: "라이트", icon: "sun" }
        ]
      }
    }
  },
  initialGlobals: { theme: "dark" },
  decorators: [
    (storyFn, context) => {
      document.documentElement.classList.toggle("dark", context.globals.theme !== "light");
      return storyFn();
    }
  ],
  parameters: {
    layout: "padded",
    // 배경은 테마 토큰(body의 bg-background)을 따라가요.
    backgrounds: { disable: true },
    viewport: {
      options: {
        mobile: { name: "모바일 (375px)", styles: { width: "375px", height: "720px" }, type: "mobile" },
        mobileSmall: { name: "작은 모바일 (320px)", styles: { width: "320px", height: "640px" }, type: "mobile" },
        tablet: { name: "태블릿 (768px)", styles: { width: "768px", height: "1024px" }, type: "tablet" }
      }
    },
    a11y: { test: "todo" }
  }
};

export default preview;
