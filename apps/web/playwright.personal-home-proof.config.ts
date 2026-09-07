import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/personal-home-proof", fullyParallel: false,
  use: { baseURL: process.env.PERSONAL_HOME_PROOF_URL ?? "http://127.0.0.1:6011", contextOptions: { reducedMotion: "reduce" } },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 1024 } } }, { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
});
