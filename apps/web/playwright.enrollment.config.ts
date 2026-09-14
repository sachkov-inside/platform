import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack.config";

// This suite requires the verified recipient/provider fixture owned by smoke:enrollments.
export default defineConfig({ ...fullstack, testIgnore: [], testMatch: "**/enrollment.spec.ts" });
