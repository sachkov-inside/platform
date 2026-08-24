import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    {
      name: "@storybook/addon-mcp",
      options: {
        endpoint: "/mcp",
      },
    },
  ],
  framework: "@storybook/nextjs-vite",
  typescript: {
    // Accurate prop extraction is worth the extra dev-time work because the MCP
    // manifest is a public interface for both human and AI consumers.
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
