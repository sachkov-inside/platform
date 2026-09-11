import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  staticDirs: [
    "../public",
    {
      from: "./fixtures/reader-images",
      to: "/api/materials/02000000-0000-4000-8000-000000000010/assets/image-agent-path/images",
    },
    { from: "../../../docs/evidence/issue-271/covers", to: "/api/content-covers" },
  ],
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
        include: ["@tiptap/core", "@tiptap/react", "@inside/material-blocks/schema"],
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
