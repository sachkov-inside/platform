---
status: accepted
---

# Use one TypeScript 7 and Oxc toolchain

Platform uses exactly one project TypeScript version: TypeScript 7. Next invokes the project-local
`tsc` CLI, Oxlint plus `oxlint-tsgolint` owns native type-aware linting, and custom architecture
analysis uses `oxc-parser`. ESLint, JavaScript lint plugins, the TypeScript compiler API, and a
side-by-side TypeScript 6 compatibility engine are not part of the toolchain.

Next-specific Storybook integration and `openapi-typescript` were replaced because they load compiler
APIs unavailable in TypeScript 7. Storybook uses its stable React/Vite framework with a narrow
`next/link` preview mock, while the OpenAPI client uses a template generator and remains protected by
deterministic drift checks, runtime Zod validation, architecture guardrails, tests, and builds.
