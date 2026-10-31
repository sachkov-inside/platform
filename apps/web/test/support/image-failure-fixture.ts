import { test as base } from "@playwright/test";
import { observeImageFailure } from "./image-failure-diagnostics";

export const test = base.extend<{ imageDiagnostics: undefined }>({
  imageDiagnostics: [
    async ({ page }, runTest, testInfo) => {
      const observation = observeImageFailure(page);
      try {
        await runTest(undefined);
      } finally {
        if (
          testInfo.retry === 0 &&
          testInfo.status !== testInfo.expectedStatus
        ) {
          try {
            await testInfo.attach("image-first-failure", {
              body: JSON.stringify(await observation.snapshot()),
              contentType: "application/json",
            });
          } catch {
            // Diagnostics must preserve the original failure and permit page cleanup.
          }
        }
        observation.dispose();
      }
    },
    { auto: true },
  ],
});
