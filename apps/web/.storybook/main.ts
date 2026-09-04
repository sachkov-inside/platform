import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/!(*.prototype).stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
  ],
  framework: "@storybook/react-vite",
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      optimizeDeps: {
        include: ["@tiptap/core", "@tiptap/react", "@tiptap/starter-kit"],
      },
      resolve: {
        alias: {
          "@": fileURLToPath(new URL("../src", import.meta.url)),
          "next/link": fileURLToPath(
            new URL("./mocks/next-link.tsx", import.meta.url),
          ),
          "next/navigation": fileURLToPath(
            new URL("./mocks/next-navigation.ts", import.meta.url),
          ),
        },
      },
    }),
  typescript: { reactDocgen: "react-docgen" },
};

export default config;
