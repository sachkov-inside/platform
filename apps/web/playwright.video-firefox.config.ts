import { defineConfig } from "@playwright/test";

import navigation from "./playwright.navigation.config";

/** Focused Firefox and WebKit reproduction of the Reader playback and history contracts. */
export default defineConfig({
  ...navigation,
  testMatch: /video-(cover|fragment|recovery)\.spec\.ts$/u,
  projects: [
    {
      name: "desktop-webkit-video",
      use: {
        browserName: "webkit",
        viewport: { width: 1_440, height: 1_024 },
      },
    },
    {
      name: "desktop-firefox-video",
      use: {
        browserName: "firefox",
        viewport: { width: 1_440, height: 1_024 },
      },
    },
  ],
});
