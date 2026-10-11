import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __fragmentProbe: {
      arm(): void;
      waitForWrite(): Promise<undefined>;
      snapshot(): readonly Record<string, unknown>[];
    };
  }
}

test("a pending Reader refresh cannot erase a native video fragment before its listener", async ({
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
  await page.route("**/api/material-video-playback-sessions", (route) =>
    route.fulfill({
      json: {
        drmAuthToken: null,
        embedLocator: "https://kinescope.io/embed/fragment-video",
        progressScope: "account",
        resumeSeconds: 37,
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
  await page.addInitScript(() => {
    const ledger: Record<string, unknown>[] = [];
    const captured = Promise.withResolvers<undefined>();
    let armed = false;
    let refreshReceived = false;
    let write: (() => void) | undefined;
    window.__fragmentProbe = {
      arm: () => {
        armed = true;
      },
      waitForWrite: () => captured.promise,
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
            const iframe = document.createElement("iframe");
            iframe.src = options.url;
            mount.append(iframe);
            return Promise.resolve({
              Events: { TimeUpdate: "time", Pause: "pause", Ended: "ended" },
              destroy: () => {
                iframe.remove();
                return Promise.resolve();
              },
              getDuration: () => Promise.resolve(600),
              on: () => undefined,
              seekTo: (seconds: number) => {
                ledger.push({ seek: seconds, live: location.href });
                iframe.dataset["seekSeconds"] = String(seconds);
                return Promise.resolve();
              },
            });
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
