import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __playerProbe: {
      emit(event: "time" | "error", currentTime?: number): void;
      players(): number;
    };
  }
}

// Kinescope asks for a licence again long after the page opened; a refused one ends in the
// player's own error screen, and its «Обновить» repeats the same token. The Reader recovers with
// a new session where the viewer was.
for (const outcome of ["recovers", "fails-again"] as const) {
  test(`a player error during playback ${outcome === "recovers" ? "resumes with a new session" : "twice in a row offers a retry"}`, async ({
    page,
  }) => {
    let sessions = 0;
    await page.route("**/api/material-video-playback-sessions", (route) => {
      sessions += 1;
      return route.fulfill({
        json: {
          drmAuthToken: `token-${String(sessions)}`,
          embedLocator: "https://kinescope.io/embed/poster-test",
          progressScope: "anonymous",
          resumeSeconds: 37,
          videoId: "44444444-4444-4444-8444-444444444444",
        },
      });
    });
    await page.route("https://kinescope.io/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Video</title>" }),
    );
    await page.route("**/api/content-covers/**", (route) =>
      route.fulfill({
        contentType: "image/webp",
        path: resolve(
          "../../docs/evidence/issue-271/covers/27100000-0000-4000-8000-000000000001/960",
        ),
      }),
    );
    await page.addInitScript(() => {
      let players = 0;
      let handlers = new Map<string, Set<(event: unknown) => void>>();
      window.__playerProbe = {
        emit: (event, currentTime = 0) => {
          for (const handler of handlers.get(event) ?? [])
            handler({ data: { currentTime } });
        },
        players: () => players,
      };
      Object.defineProperty(window, "Kinescope", {
        value: {
          IframePlayer: {
            version: "1.0.0",
            create: (mount: HTMLElement, options: { url: string }) => {
              players += 1;
              const own = new Map<string, Set<(event: unknown) => void>>();
              handlers = own;
              const iframe = document.createElement("iframe");
              iframe.src = options.url;
              iframe.dataset["player"] = String(players);
              mount.append(iframe);
              return Promise.resolve({
                Events: {
                  Ended: "ended",
                  Error: "error",
                  Pause: "pause",
                  TimeUpdate: "time",
                },
                on: (event: string, handler: (event: unknown) => void) => {
                  const set = own.get(event) ?? new Set();
                  set.add(handler);
                  own.set(event, set);
                },
                off: (event: string, handler: (event: unknown) => void) => {
                  own.get(event)?.delete(handler);
                },
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
    const iframe = page.locator("[data-video-player-mount] iframe");
    await expect(iframe).toHaveAttribute("data-position", "37");
    await page
      .getByRole("button", { name: "Смотреть видео: Fragment video" })
      .click();
    await expect(iframe).toHaveAttribute("data-playing", "true");
    await page.evaluate(() => {
      window.__playerProbe.emit("time", 412);
      window.__playerProbe.emit("error");
    });

    // A second session, a second player with its token, at the moment the viewer reached.
    await expect(iframe).toHaveAttribute("data-player", "2");
    await expect(iframe).toHaveAttribute("src", /drmauthtoken=token-2/u);
    await expect(iframe).toHaveAttribute("data-position", "412");
    await expect(iframe).toHaveAttribute("data-playing", "true");
    expect(sessions).toBe(2);

    if (outcome === "fails-again") {
      // A new token that fails at once is not a stale token: the Reader stops and asks.
      await page.evaluate(() => {
        window.__playerProbe.emit("error");
      });
      const retry = page.getByRole("button", { name: "Повторить" });
      await expect(retry).toBeVisible();
      expect(sessions).toBe(2);
      await retry.click();
      await expect(iframe).toHaveAttribute("data-player", "3");
      await expect(iframe).toHaveAttribute("data-playing", "true");
      expect(sessions).toBe(3);
    } else {
      // Playing on after the recovery restores it for a later licence refusal.
      await page.evaluate(() => {
        window.__playerProbe.emit("time", 500);
      });
      await page.evaluate(() => {
        window.__playerProbe.emit("error");
      });
      await expect(iframe).toHaveAttribute("data-player", "3");
      expect(sessions).toBe(3);
    }
  });
}
