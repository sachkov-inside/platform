import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack.config";

// This suite requires the stand, bank double and sign-in provider owned by smoke:buyer-journey.
export default defineConfig({
  ...fullstack,
  timeout: 120_000,
  testIgnore: [],
  testMatch: "**/buyer-journey.spec.ts",
});
