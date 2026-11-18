import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { installVideoProvider } from "./video-provider.fixture";

for (const activation of [
  "mouse",
  "Enter",
  "Space",
  "early",
  "play-error",
] as const) {
  test(`Material cover starts the resumed player with ${activation}`, async ({
    page,
  }, testInfo) => {
    const releaseSession = Promise.withResolvers<undefined>();
    await page.route(
      "**/api/material-video-playback-sessions",
      async (route) => {
        if (activation === "early") await releaseSession.promise;
        await route.fulfill({
          json: {
            drmAuthToken: null,
            embedLocator: "https://kinescope.io/embed/poster-test",
            progressScope: "anonymous",
            resumeSeconds: 37,
            videoId: "44444444-4444-4444-8444-444444444444",
          },
        });
      },
    );
    await installVideoProvider(page, {
      failFirstPlay: activation === "play-error",
    });
    await page.route("**/api/content-covers/**", (route) =>
      route.fulfill({
        contentType: "image/webp",
        path: resolve(
          "../../docs/evidence/issue-271/covers/27100000-0000-4000-8000-000000000001/960",
        ),
      }),
    );
    await page.goto("/materials/navigation-video-cover");
    const start = page.getByRole("button", {
      name: "Смотреть видео: Fragment video",
    });
    await expect(start).toBeVisible();
    await expect
      .poll(() =>
        start
          .locator("img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    const iframe = page.locator("[data-video-player-mount] iframe");
    if (activation !== "early")
      await expect(iframe).toHaveAttribute("data-position", "37");
    await expect(page.locator("[data-video-player-mount]")).toHaveAttribute(
      "inert",
      "",
    );
    if (activation === "mouse") {
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("before-play.png") });
    }
    if (activation === "Enter" || activation === "Space") {
      await start.focus();
      await page.keyboard.press(activation);
    } else await start.click();
    releaseSession.resolve(undefined);
    await expect(start).toHaveCount(0);
    if (activation === "play-error") {
      await page.getByRole("button", { name: "Повторить" }).click();
    }
    await expect(iframe).toHaveAttribute("data-playing", "true");
    await expect(iframe).toHaveAttribute("data-position", "37");
    await page.getByRole("link", { name: "4:21 Later chapter" }).click();
    await expect(iframe).toHaveAttribute("data-position", "261");
    await page.goto("/materials/navigation-video-cover#t=3");
    await expect(start).toHaveCount(0);
    await expect(
      page.locator("[data-video-player-mount] iframe"),
    ).toHaveAttribute("data-position", "3");
  });
}
