import { expect, test } from "@playwright/test";

for (const activation of ["mouse", "Enter", "Space"] as const) {
  test(`Material cover starts the resumed player with ${activation}`, async ({
    page,
  }) => {
    await page.route("**/api/material-video-playback-sessions", (route) =>
      route.fulfill({
        json: {
          drmAuthToken: null,
          embedLocator: "https://kinescope.io/embed/poster-test",
          progressScope: "anonymous",
          resumeSeconds: 37,
          videoId: "44444444-4444-4444-8444-444444444444",
        },
      }),
    );
    await page.route("https://kinescope.io/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Video</title>" }),
    );
    await page.addInitScript(() => {
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
    });
    await page.goto("/materials/navigation-video-cover");
    const start = page.getByRole("button", {
      name: "Смотреть видео: Fragment video",
    });
    await expect(start).toBeVisible();
    const iframe = page.locator("[data-video-player-mount] iframe");
    await expect(iframe).toHaveAttribute("data-position", "37");
    await expect(page.locator("[data-video-player-mount]")).toHaveAttribute(
      "inert",
      "",
    );
    if (activation === "mouse") await start.click();
    else {
      await start.focus();
      await page.keyboard.press(activation);
    }
    await expect(start).toHaveCount(0);
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
