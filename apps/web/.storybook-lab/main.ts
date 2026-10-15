import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: ["../src/storybook/design-lab/**/*.prototype.stories.tsx"],
  addons: ["@storybook/addon-a11y"],
  framework: "@storybook/react-vite",
  viteFinal: (config) =>
    mergeConfig(config, {
      resolve: {
        alias: {
          "@": fileURLToPath(new URL("../src", import.meta.url)),
          "next/link": fileURLToPath(
            new URL("../.storybook/mocks/next-link.tsx", import.meta.url),
          ),
          "next/navigation": fileURLToPath(
            new URL("../.storybook/mocks/next-navigation.ts", import.meta.url),
          ),
        },
      },
    }),
};
export default config;
