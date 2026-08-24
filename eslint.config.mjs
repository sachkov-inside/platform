import eslint from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import storybook from "eslint-plugin-storybook";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const webTypeScriptFiles = ["apps/web/**/*.{ts,tsx,mts,cts}"];
const webClientFiles = ["apps/web/**/*.client.{ts,tsx}"];

export default tseslint.config(
  {
    ignores: [
      ".agents/**",
      ".claude/**",
      ".inside-harness/**",
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "**/playwright-report/**",
      "**/storybook-static/**",
      "**/test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: webTypeScriptFiles,
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/_pages/*/*",
                "@/widgets/*/*",
                "@/features/*/*",
                "@/entities/*/*",
                "@/shared/*/*/*/*",
              ],
              message: "Import the slice public interface instead of its internals.",
            },
          ],
        },
      ],
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: webTypeScriptFiles,
  },
  {
    files: webClientFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/*.server", "**/index.server"],
              message: "Client modules cannot import server-only interfaces.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@/_app/**",
            "@/_pages/**",
            "@/widgets/**",
            "@/features/**",
            "@/entities/**",
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/widgets/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["@/_app/**", "@/_pages/**"] }],
    },
  },
  {
    files: ["apps/web/src/_pages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["@/_app/**"] }],
    },
  },
  storybook.configs["flat/recommended"],
);
