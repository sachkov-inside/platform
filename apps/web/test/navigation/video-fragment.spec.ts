import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __releaseVideoMetadata(phase: "loaded" | "duration" | "error"): void;
    __fragmentProbe: {
      arm(): void;
      waitForWrite(): Promise<undefined>;
      players(): number;
      snapshot(): readonly Record<string, unknown>[];
    };
  }
}

test("a Reader refresh keeps the player and cannot erase a native video fragment", async ({
  page,
}, testInfo) => {
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: {
        accountId: "55555555-5555-4555-8555-555555555501",
        canManageMaterials: false,
        state: "authenticated",
      },
    }),
  );
  await page.route("**/api/reading-progress/states", (route) =>
    route.fulfill({ json: { kind: "ready", states: [] } }),
  );
  const opened = Promise.withResolvers<undefined>();
  const releaseOpen = Promise.withResolvers<undefined>();
  await page.route("**/api/reading-progress/open", async (route) => {
    opened.resolve(undefined);
    await releaseOpen.promise;
    await route.fulfill({
      json: {
        kind: "saved",
        openedAt: "2030-01-01T00:00:00.000Z",
        replayed: false,
      },
    });
  });
  let playbackSessions = 0;
  await page.route("**/api/material-video-playback-sessions", (route) => {
    playbackSessions += 1;
    return route.fulfill({
      json: {
        drmAuthToken: null,
        embedLocator: "https://kinescope.io/embed/fragment-video",
        progressScope: "account",
        resumeSeconds: 37,
        videoId: "44444444-4444-4444-8444-444444444444",
      },
    });
  });
  await page.route("https://kinescope.io/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Test video</title>",
    }),
  );
  await page.addInitScript(() => {
    const ledger: Record<string, unknown>[] = [];
    const captured = Promise.withResolvers<undefined>();
    let armed = false;
    let players = 0;
    let refreshReceived = false;
    let write: (() => void) | undefined;
    window.__fragmentProbe = {
      arm: () => {
        armed = true;
      },
      waitForWrite: () => captured.promise,
      players: () => players,
      snapshot: () => ledger,
    };
    const nativeFetch = window.fetch;
    window.fetch = async (...args) => {
      const [input, init] = args;
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const matching =
        armed &&
        url.pathname === "/materials/navigation-video-fragment" &&
        headers.get("rsc") === "1" &&
        !headers.has("next-router-prefetch");
      const response = await nativeFetch(...args);
      if (matching) {
        await response.clone().arrayBuffer();
        refreshReceived = true;
        ledger.push({ refreshReceived: true });
      }
      return response;
    };
    for (const method of ["pushState", "replaceState"] as const) {
      const native = window.history[method].bind(window.history);
      window.history[method] = (
        data: unknown,
        unused: string,
        url?: string | URL | null,
      ) => {
        const internal =
          typeof data === "object" && data !== null && "__NA" in data;
        ledger.push({
          method,
          from: location.href,
          to: String(url),
          internal,
        });
        // Hold the actual refresh commit, then replay only its History write before
        // the player handles native hashchange. No URL or router payload is fabricated.
        if (
          armed &&
          refreshReceived &&
          internal &&
          method === "replaceState" &&
          write === undefined
        ) {
          armed = false;
          write = () => {
            native(data, unused, url);
          };
          captured.resolve(undefined);
          return;
        }
        native(data, unused, url);
      };
    }
    window.addEventListener("hashchange", (event) => {
      if (write !== undefined) {
        write();
        write = undefined;
      }
      ledger.push({
        event: "hashchange",
        oldURL: event.oldURL,
        newURL: event.newURL,
        live: location.href,
      });
    });
    window.addEventListener("popstate", () =>
      ledger.push({ event: "popstate", live: location.href }),
    );
    Object.defineProperty(window, "Kinescope", {
      value: {
        IframePlayer: {
          version: "1.0.0",
          create: (mount: HTMLElement, options: { url: string }) => {
            players += 1;
            const iframe = document.createElement("iframe");
            iframe.src = options.url;
            mount.append(iframe);
            const player = {
              Events: { TimeUpdate: "time", Pause: "pause", Ended: "ended" },
              destroy: () => {
                iframe.remove();
                return Promise.resolve();
              },
              getDuration: () => Promise.resolve(600),
              on: () => undefined,
              off: () => undefined,
              seekTo: (seconds: number) => {
                ledger.push({ seek: seconds, live: location.href });
                iframe.dataset["seekSeconds"] = String(seconds);
                return Promise.resolve();
              },
            };
            return Promise.resolve(player);
          },
        },
      },
    });
  });
  try {
    await page.goto("/materials/navigation-video-fragment");
    const frame = page.locator("[data-video-player-mount] iframe");
    await expect(frame).toHaveAttribute("data-seek-seconds", "37");
    await opened.promise;
    await page.evaluate(() => {
      window.__fragmentProbe.arm();
    });
    releaseOpen.resolve(undefined);
    await page.evaluate(() => window.__fragmentProbe.waitForWrite());
    await page.goto("/materials/navigation-video-fragment#t=3");
    await expect(frame).toHaveAttribute("data-seek-seconds", "3");
    await expect(page).toHaveURL(/#t=3$/u);
    // The refreshed Reader payload carries equal props: the live player keeps its session.
    expect(await page.evaluate(() => window.__fragmentProbe.players())).toBe(1);
    expect(playbackSessions).toBe(1);
    // Selecting the current chapter emits the production synthetic event (no newURL).
    await page.getByRole("link", { name: "0:03 Early chapter" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.__fragmentProbe
            .snapshot()
            .filter((entry) => "seek" in entry)
            .map((entry) => entry["seek"])
            .slice(-2),
        ),
      )
      .toEqual([3, 3]);
    // Queued native events retain their own URLs even when location already moved again.
    await page.evaluate(() => {
      location.hash = "t=0";
      location.hash = "t=261";
    });
    await expect(frame).toHaveAttribute("data-seek-seconds", "261");
    await expect(page).toHaveURL(/#t=261$/u);
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.__fragmentProbe
            .snapshot()
            .filter((entry) => "seek" in entry)
            .map((entry) => entry["seek"])
            .slice(-4),
        ),
      )
      .toEqual([3, 3, 0, 261]);
  } finally {
    releaseOpen.resolve(undefined);
    await testInfo.attach("fragment-ledger", {
      body: JSON.stringify(
        await page.evaluate(() => window.__fragmentProbe.snapshot()),
        null,
        2,
      ),
      contentType: "application/json",
    });
  }
});

for (const failed of [false, true]) {
  test(
    failed
      ? "metadata failure can retry a provider that replaces its mount"
      : "chapters wait for a positive duration after provider load",
    async ({ page }) => {
      await page.route("**/api/reading-progress/open", (route) =>
        route.fulfill({
          json: {
            kind: "saved",
            openedAt: "2030-01-01T00:00:00.000Z",
            replayed: false,
          },
        }),
      );
      await page.route("**/api/material-video-playback-sessions", (route) =>
        route.fulfill({
          json: {
            drmAuthToken: null,
            embedLocator: "https://kinescope.io/embed/fragment-video",
            progressScope: "anonymous",
            resumeSeconds: null,
            videoId: "44444444-4444-4444-8444-444444444444",
          },
        }),
      );
      await page.route("https://kinescope.io/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>Test video</title>",
        }),
      );
      await page.addInitScript((holdDuration: boolean) => {
        let attempts = 0;
        Object.defineProperty(window, "Kinescope", {
          value: {
            IframePlayer: {
              version: "1.0.0",
              create: (mount: HTMLElement, options: { url: string }) => {
                const iframe = document.createElement("iframe");
                iframe.src = options.url;
                mount.replaceWith(iframe);
                const retry = attempts++ > 0;
                let duration = retry ? 600 : 0;
                let durationReads = 0;
                let releaseDuration: ((value: number) => void) | undefined;
                const listeners = new Map<string, () => void>();
                const player = {
                  Events: {
                    Loaded: "loaded",
                    DurationChange: "duration",
                    Error: "error",
                    TimeUpdate: "time",
                    Pause: "pause",
                    Ended: "ended",
                  },
                  destroy: () => {
                    iframe.remove();
                    return Promise.resolve();
                  },
                  getDuration: () => {
                    iframe.dataset["durationRequested"] = "true";
                    iframe.dataset["durationReads"] = String(++durationReads);
                    if (holdDuration && !retry)
                      return new Promise<number>((resolve) => {
                        releaseDuration = resolve;
                      });
                    return Promise.resolve(duration);
                  },
                  on: (event: string, listener: () => void) => {
                    listeners.set(event, listener);
                  },
                  off: (event: string) => {
                    listeners.delete(event);
                  },
                  seekTo: (seconds: number) => {
                    iframe.dataset["seekSeconds"] = String(seconds);
                    return Promise.resolve();
                  },
                };
                // This is the provider boundary: metadata arrives after create()/getDuration().
                Object.defineProperty(window, "__releaseVideoMetadata", {
                  configurable: true,
                  value: (phase: "loaded" | "duration" | "error") => {
                    if (phase === "duration") duration = 600;
                    listeners.get(phase)?.();
                    if (phase === "error") releaseDuration?.(0);
                  },
                });
                return Promise.resolve(player);
              },
            },
          },
        });
      }, failed);
      await page.goto("/materials/navigation-video-fragment#t=3");
      const frame = page.locator("[data-video-id] iframe");
      await expect(frame).toHaveAttribute("data-duration-requested", "true");
      // The provider owns the area once it exists; metadata arrives behind its own UI.
      await expect(
        page.getByText("Загружаем видео…", { exact: true }),
      ).not.toBeVisible();
      await page.getByRole("link", { name: "4:21 Later chapter" }).click();
      if (!failed) {
        await page.evaluate(() => {
          window.__releaseVideoMetadata("loaded");
        });
        await expect(frame).toHaveAttribute("data-duration-reads", "2");
      }
      await page.evaluate((failed) => {
        window.__releaseVideoMetadata(failed ? "error" : "duration");
      }, failed);
      if (failed) {
        await expect(
          page.getByRole("button", { name: "Повторить", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Загружаем видео…", { exact: true }),
        ).not.toBeVisible();
        await page
          .getByRole("button", { name: "Повторить", exact: true })
          .click();
        await expect(frame).toHaveAttribute("data-seek-seconds", "261");
        return;
      }
      await expect(frame).toHaveAttribute("data-seek-seconds", "261");
      await expect(
        page.getByRole("link", { name: "4:21 Later chapter" }),
      ).toHaveAttribute("aria-current", "true");
    },
  );
}

test("a provider script failure offers a retry that requests the script anew", async ({
  page,
}) => {
  await page.route("**/api/reading-progress/open", (route) =>
    route.fulfill({
      json: {
        kind: "saved",
        openedAt: "2030-01-01T00:00:00.000Z",
        replayed: false,
      },
    }),
  );
  await page.route("**/api/material-video-playback-sessions", (route) =>
    route.fulfill({
      json: {
        drmAuthToken: null,
        embedLocator: "https://kinescope.io/embed/fragment-video",
        progressScope: "anonymous",
        resumeSeconds: null,
        videoId: "44444444-4444-4444-8444-444444444444",
      },
    }),
  );
  await page.route("https://kinescope.io/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Test video</title>",
    }),
  );
  const scriptRequests: string[] = [];
  let available = false;
  // The real loader runs; only the provider's script response is replaced.
  await page.route("https://player.kinescope.io/**", (route) => {
    scriptRequests.push(route.request().url());
    if (!available) return route.abort("connectionfailed");
    return route.fulfill({
      contentType: "application/javascript",
      body: `
        window.Kinescope = { IframePlayer: { version: "1.0.0", create: (mount, options) => {
          const iframe = document.createElement("iframe");
          iframe.src = options.url;
          mount.append(iframe);
          return Promise.resolve({
            Events: { Loaded: "loaded", DurationChange: "duration", Error: "error",
              TimeUpdate: "time", Pause: "pause", Ended: "ended" },
            destroy: () => { iframe.remove(); return Promise.resolve(); },
            getDuration: () => Promise.resolve(600),
            on: () => undefined,
            off: () => undefined,
            seekTo: () => Promise.resolve(),
          });
        } } };
        window.KinescopeIframeApiReadyHandlers = {
          push: (handler) => handler(window.Kinescope.IframePlayer),
        };
      `,
    });
  });
  await page.goto("/materials/navigation-video-fragment");
  const retry = page.getByRole("button", { name: "Повторить", exact: true });
  await expect(retry).toBeVisible();
  expect(scriptRequests).toEqual([
    "https://player.kinescope.io/latest/iframe.player.js",
    "https://player.kinescope.io/latest/iframe.player.js?attempt=2",
    "https://player.kinescope.io/latest/iframe.player.js?attempt=3",
  ]);
  available = true;
  await retry.click();
  await expect(page.locator("[data-video-player-mount] iframe")).toBeVisible();
  await expect(
    page.getByText("Загружаем видео…", { exact: true }),
  ).not.toBeVisible();
  expect(scriptRequests).toEqual([
    "https://player.kinescope.io/latest/iframe.player.js",
    "https://player.kinescope.io/latest/iframe.player.js?attempt=2",
    "https://player.kinescope.io/latest/iframe.player.js?attempt=3",
    "https://player.kinescope.io/latest/iframe.player.js?attempt=4",
  ]);
});
