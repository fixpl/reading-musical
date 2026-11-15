import type { StorybookConfig } from "@storybook/sveltekit";

const config: StorybookConfig = {
  framework: "@storybook/sveltekit",
  core: { disableTelemetry: true },
  stories: ["../src/**/*.stories.@(svelte|ts)"],
  addons: ["@storybook/addon-svelte-csf", "@storybook/addon-a11y", "@storybook/addon-docs"]
};

export default config;
