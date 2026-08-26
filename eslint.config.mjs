import eslint from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tanstackQuery from "@tanstack/eslint-plugin-query";
import storybook from "eslint-plugin-storybook";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const webTypeScriptFiles = ["apps/web/**/*.{ts,tsx,mts,cts}"];
const webClientFiles = ["apps/web/**/*.client.{ts,tsx}"];
const backendTypeScriptFiles = ["apps/backend/**/*.{ts,mts,cts}"];

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
      "apps/backend/test/guardrails/fixtures/architecture/**",
      "apps/backend/test/guardrails/fixtures/typescript/**",
      "apps/backend/src/infrastructure/prisma/generated/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: backendTypeScriptFiles,
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
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-indexed-object-style": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    // Nest modules are decorator metadata containers; their classes are intentionally bodyless.
    files: ["apps/backend/src/**/*.module.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },
  {
    files: [
      "apps/backend/src/modules/**/*.ts",
      "apps/backend/test/guardrails/fixtures/eslint/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@nestjs/**",
                "@prisma/client",
                "@prisma/client/**",
                "@prisma/adapter-**",
                "kysely",
                "kysely/**",
                "pg",
                "pg/**",
                "**/infrastructure/postgres/generated/**",
                "**/infrastructure/prisma/generated/**",
                "**/modules/*/internal/**",
              ],
              message:
                "Capability implementation cannot depend on framework or persistence internals.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/backend/src/modules/*/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@nestjs/**",
                "@prisma/**",
                "kysely",
                "kysely/**",
                "pg",
                "pg/**",
                "**/infrastructure/postgres/generated/**",
                "**/infrastructure/prisma/**",
                "**/modules/*/internal/**",
              ],
              message: "Domain models cannot depend on Nest or persistence adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/backend/src/modules/*/infrastructure/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/modules/*/internal/**"],
              message: "Capability infrastructure cannot import another module's internals.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/backend/src/modules/**/*.module.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@prisma/client",
                "@prisma/client/**",
                "@prisma/adapter-**",
                "kysely",
                "kysely/**",
                "pg",
                "pg/**",
                "**/infrastructure/postgres/generated/**",
                "**/infrastructure/prisma/generated/**",
                "**/modules/*/internal/**",
              ],
              message:
                "Nest modules may compose shared providers, not raw persistence internals.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/backend/src/modules/**/*.controller.ts",
      "apps/backend/src/modules/**/*.filter.ts",
      "apps/backend/src/modules/*/adapters/nest/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "kysely",
                "kysely/**",
                "pg",
                "pg/**",
                "**/infrastructure/postgres/generated/**",
                "**/infrastructure/prisma/**",
                "**/modules/*/internal/**",
              ],
              message:
                "Nest adapters may use the module interface, not persistence internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // The registry may load frozen migrations, but no other Materials implementation detail.
    files: ["apps/backend/src/migrations/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "modules/materials/(?!infrastructure/postgres/migrations/)",
              message: "Migration code may import only frozen capability migrations.",
            },
            {
              group: ["**/modules/*/internal/**"],
              message: "Migration code cannot import capability internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // Generated database shapes and frozen migrations are external/immutable inputs.
    files: [
      "apps/backend/src/infrastructure/prisma/generated/**/*.ts",
      "apps/backend/src/modules/*/infrastructure/postgres/migrations/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
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
  ...tanstackQuery.configs["flat/recommended"].map((config) => ({
    ...config,
    files: webTypeScriptFiles,
  })),
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
