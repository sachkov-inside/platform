import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { installVideoProvider } from "./video-provider.fixture";

import { observeAppShellPrefetch } from "../support/app-shell-prefetch";

declare global {
  interface Window {
    __playerProbe: {
      emit(
        event: "time" | "pause" | "ended" | "error",
        currentTime?: number,
      ): void;
      preferences(volume: number, playbackRate: number): void;
      players(): number;
    };
  }
}

// Kinescope asks for a licence again long after the page opened; a refused one ends in the
// player's own error screen, and its «Обновить» repeats the same token. The Reader recovers with
// a new session where the viewer was.
const titles = {
  recovers: "resumes with a new session",
  "fails-again": "twice in a row offers a retry",
  paused: "while paused keeps the new player paused",
  "back-paused": "a paused video stays paused after navigating away and back",
  "back-ended": "a finished video stays paused after navigating away and back",
  "back-settings": "keeps volume and speed after navigating away and back",
  "reload-settings": "keeps volume and speed after a full reload",
  "recovery-settings": "keeps volume and speed after player recovery",
  "back-playing":
    "a playing video waits for Play after navigating away and back",
} as const;

for (const outcome of [
  "back-settings",
  "reload-settings",
  "recovery-settings",
  "recovers",
  "fails-again",
  "paused",
  "back-paused",
  "back-ended",
  "back-playing",
] as const) {
  test(titles[outcome], async ({ page }) => {
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
    await installVideoProvider(page);
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
      const send = (data: Record<string, unknown>) => {
        document
          .querySelector<HTMLIFrameElement>("[data-video-player-mount] iframe")
          ?.contentWindow?.postMessage(
            { type: "video-provider-stimulus", ...data },
            "https://kinescope.io",
          );
      };
      window.addEventListener("video-provider-observation", (event) => {
        if (
          event instanceof CustomEvent &&
          typeof event.detail === "object" &&
          event.detail !== null &&
          Reflect.get(event.detail, "ready") === true
        )
          players += 1;
      });
      window.__playerProbe = {
        emit: (event, currentTime = 0) => {
          send({ event: event === "time" ? "timeupdate" : event, currentTime });
        },
        preferences: (volume, playbackRate) => {
          send({ event: "preferences", volume, rate: playbackRate });
        },
        players: () => players,
      };
    });

    const programmePrefetch = await observeAppShellPrefetch(
      page,
      "/products/navigation-proof/programme",
    );
    await page.goto("/materials/navigation-video-cover");
    const iframe = page.locator("[data-video-player-mount] iframe");
    await expect(iframe).toHaveAttribute("data-position", "37");
    await page
      .getByRole("button", { name: "Смотреть видео: Fragment video" })
      .click();
    await expect(iframe).toHaveAttribute("data-playing", "true");
    const settings = outcome.endsWith("-settings");
    if (settings) {
      await page.evaluate(() => {
        window.__playerProbe.preferences(0.35, 1.75);
      });
      if (outcome === "reload-settings") {
        await page.reload();
        await expect(iframe).toHaveAttribute("data-position", "37");
      } else if (outcome === "recovery-settings") {
        await page.evaluate(() => {
          window.__playerProbe.emit("error");
        });
        await expect(iframe).toHaveAttribute("data-player", "2");
      }
      if (outcome !== "back-settings") {
        await expect(iframe).toHaveAttribute("data-volume", "0.35");
        await expect(iframe).toHaveAttribute("data-rate", "1.75");
        return;
      }
    }
    if (
      outcome === "back-settings" ||
      outcome === "back-paused" ||
      outcome === "back-ended" ||
      outcome === "back-playing"
    ) {
      await page.evaluate((state) => {
        window.__playerProbe.emit("time", state === "back-ended" ? 600 : 412);
        if (state === "back-paused") window.__playerProbe.emit("pause");
        if (state === "back-ended") window.__playerProbe.emit("ended");
      }, outcome);
      const otherMaterial = page
        .getByRole("link", { name: "Назад", exact: true })
        .last();
      await otherMaterial.scrollIntoViewIfNeeded();
      await otherMaterial.hover();
      await programmePrefetch.ready();
      await otherMaterial.click();
      await expect(page).not.toHaveURL(/navigation-video-cover/u);
      await page.goBack();
      await expect(page).toHaveURL(/navigation-video-cover/u);
      await expect(iframe).toHaveAttribute("data-player", "2");
      if (outcome !== "back-ended")
        await expect(iframe).toHaveAttribute("data-position", "412");
      // The seek and chapter update settle before the queued playback decision.
      await page.getByRole("link", { name: "4:21 Later chapter" }).click();
      await expect(iframe).toHaveAttribute("data-position", "261");
      await expect(iframe).not.toHaveAttribute("data-playing");
      if (settings) {
        await expect(iframe).toHaveAttribute("data-volume", "0.35");
        await expect(iframe).toHaveAttribute("data-rate", "1.75");
      }
      return;
    }
    await page.evaluate((pause) => {
      window.__playerProbe.emit("time", 412);
      if (pause) window.__playerProbe.emit("pause");
      window.__playerProbe.emit("error");
    }, outcome === "paused");

    // A second session, a second player with its token, at the moment the viewer reached.
    await expect(iframe).toHaveAttribute("data-player", "2");
    await expect(iframe).toHaveAttribute("src", /drmauthtoken=token-2/u);
    await expect(iframe).toHaveAttribute("data-position", "412");
    expect(sessions).toBe(2);
    if (outcome === "paused") {
      // The chapter seek follows the start decision, so the check below sees it settled.
      await page.getByRole("link", { name: "4:21 Later chapter" }).click();
      await expect(iframe).toHaveAttribute("data-position", "261");
      await expect(iframe).not.toHaveAttribute("data-playing");
      return;
    }
    await expect(iframe).toHaveAttribute("data-playing", "true");

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

test("leaving a retained Reader removes an iframe before provider connection settles", async ({
  page,
}) => {
  await installVideoProvider(page);
  await page.route("**/api/material-video-playback-sessions", (route) =>
    route.fulfill({
      json: {
        drmAuthToken: null,
        embedLocator: "https://kinescope.io/embed/late-connection",
        progressScope: "anonymous",
        resumeSeconds: 37,
        videoId: "44444444-4444-4444-8444-444444444444",
      },
    }),
  );
  const requested = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  await page.route(
    "https://kinescope.io/embed/late-connection**",
    async (route) => {
      requested.resolve(undefined);
      await release.promise;
      await route.fallback();
    },
  );
  const prefetch = await observeAppShellPrefetch(
    page,
    "/products/navigation-proof/programme",
  );
  try {
    await page.goto("/materials/navigation-video-cover");
    await requested.promise;
    const iframe = page.locator("[data-video-player-mount] iframe");
    await expect(iframe).toHaveCount(1);
    const back = page.getByRole("link", { name: "Назад", exact: true }).last();
    await back.scrollIntoViewIfNeeded();
    await back.hover();
    await prefetch.ready();
    await back.click();
    await expect(page).toHaveURL(/programme/u);
    // Count includes retained hidden DOM. Visibility alone would miss the orphaned resource.
    await expect(iframe).toHaveCount(0);
  } finally {
    release.resolve(undefined);
  }
});
