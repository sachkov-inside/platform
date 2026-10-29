import { expect, test } from "@playwright/test";

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
    const releaseSession = Promise.withResolvers<void>();
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
    await page.route("https://kinescope.io/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Video</title>" }),
    );
    await page.addInitScript((failPlay) => {
      let failed = false;
      Object.defineProperty(window, "Kinescope", {
        value: {
          IframePlayer: {
            version: "1.0.0",
            create: (mount: HTMLElement) => {
              const iframe = document.createElement("iframe");
              iframe.src = "https://kinescope.io/embed/poster-test";
              mount.append(iframe);
              return Promise.resolve({
                Events: { TimeUpdate: "time", Pause: "pause", Ended: "ended" },
                on: () => {},
                off: () => {},
                getDuration: () => Promise.resolve(600),
                seekTo: (seconds: number) => {
                  iframe.dataset["position"] = String(seconds);
                  return Promise.resolve();
                },
                play: () => {
                  if (failPlay && !failed) {
                    failed = true;
                    return Promise.reject(new Error("Playback rejected"));
                  }
                  iframe.dataset["playing"] = "true";
                  return Promise.resolve();
                },
                destroy: () => {
                  iframe.remove();
                  return Promise.resolve();
                },
              });
            },
          },
        },
      });
    }, activation === "play-error");
    await page.goto("/materials/navigation-video-cover");
    const start = page.getByRole("button", {
      name: "Смотреть видео: Fragment video",
    });
    await expect(start).toBeVisible();
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
    releaseSession.resolve();
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
