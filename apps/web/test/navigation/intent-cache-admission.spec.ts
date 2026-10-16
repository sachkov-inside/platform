import { createHash } from "node:crypto";

import { expect, test, type Request } from "@playwright/test";

declare global {
  interface Window {
    __intentCacheAdmission?: {
      started: boolean;
      sawReaderSkeleton: boolean;
      destination: string | null;
      postClickRequests: {
        readonly url: string;
        readonly prefetch: string | null;
        readonly segmentPrefetch: string | null;
        readonly startedAt: number;
        response: {
          readonly status: number;
          readonly firstByte: string;
          readonly byteLength: number;
          readonly completedAt: number;
        } | null;
      }[];
      shellResponses: {
        readonly url: string;
        readonly status: number;
        readonly firstByte: string;
        readonly byteLength: number;
      }[];
      restore(): void;
    };
  }
}

const programme = "/products/navigation-proof/programme";
const lesson = "/materials/navigation-lesson-2";

/** Compare the real link context, excluding only Next's request cache key. */
function matchesDestination(request: Request, destination: URL): boolean {
  const requested = new URL(request.url());
  requested.searchParams.delete("_rsc");
  return (
    requested.pathname === destination.pathname &&
    requested.search === destination.search
  );
}

test("completed intent response renders the guest Reader before navigation responses", async ({
  page,
}, testInfo) => {
  // Observe rendered product DOM only; hidden streamed fallbacks are not visible skeletons.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch;
    const shellResponses: NonNullable<
      Window["__intentCacheAdmission"]
    >["shellResponses"] = [];
    const observation = {
      started: false,
      sawReaderSkeleton: false,
      destination: null as string | null,
      postClickRequests: [] as NonNullable<
        Window["__intentCacheAdmission"]
      >["postClickRequests"],
      shellResponses,
      restore() {
        window.fetch = nativeFetch;
      },
    };
    Object.assign(window, { __intentCacheAdmission: observation });
    // Match the existing public navigation probe: a clone completes the transport
    // even when the router finishes reading its own streamed shell earlier.
    window.fetch = function (...args) {
      const [input, init] = args;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      url.searchParams.delete("_rsc");
      const matchingAfterClick =
        observation.started &&
        observation.destination === url.href &&
        headers.get("rsc") === "1";
      const requestRecord: NonNullable<
        Window["__intentCacheAdmission"]
      >["postClickRequests"][number] = {
        url: url.href,
        prefetch: headers.get("next-router-prefetch"),
        segmentPrefetch: headers.get("next-router-segment-prefetch"),
        startedAt: performance.now(),
        response: null,
      };
      if (matchingAfterClick) observation.postClickRequests.push(requestRecord);
      const response = Reflect.apply(nativeFetch, this, args);
      if (headers.get("rsc") === "1") {
        response
          .then(async (result) => {
            const bytes = new Uint8Array(await result.clone().arrayBuffer());
            if (matchingAfterClick)
              requestRecord.response = {
                status: result.status,
                firstByte: new TextDecoder().decode(bytes.subarray(0, 1)),
                byteLength: bytes.byteLength,
                completedAt: performance.now(),
              };
            if (headers.get("next-router-prefetch") === "3")
              shellResponses.push({
                url: result.url,
                status: result.status,
                firstByte: new TextDecoder().decode(bytes.subarray(0, 1)),
                byteLength: bytes.byteLength,
              });
          })
          .catch(() => undefined);
      }
      return response;
    };
    const scan = () => {
      if (!observation.started) return;
      for (const skeleton of document.querySelectorAll(
        "[data-application-content] [data-route-skeleton='material-reader']",
      )) {
        if (skeleton.getClientRects().length > 0 && skeleton.checkVisibility())
          observation.sawReaderSkeleton = true;
      }
    };
    const start = () => {
      new MutationObserver(scan).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    };
    if ((document.documentElement as HTMLElement | null) === null)
      document.addEventListener("DOMContentLoaded", start);
    else start();
  });

  const navigationGate = Promise.withResolvers<undefined>();
  const heldNavigationRequests: string[] = [];
  try {
    await page.goto(programme);
    const lessonLink = page
      .locator(`[data-product-programme]:visible a[href*='${lesson}']`)
      .first();
    await expect(lessonLink).toBeVisible();
    await page.waitForFunction(() =>
      window.__intentCacheAdmission?.shellResponses.some(
        (response) =>
          /^\/materials\/[^/]+$/u.test(new URL(response.url).pathname) &&
          response.status === 200,
      ),
    );
    const href = await lessonLink.getAttribute("href");
    if (href === null) throw new Error("Programme lesson has no destination");
    const destination = new URL(href, page.url());
    expect(destination.pathname).toBe(lesson);
    expect(destination.searchParams.get("from")).toBe(
      `${programme}?page=1&at=navigation-lesson-2`,
    );

    // Header 2 is PPRRuntime, not a promise that the Reader payload was admitted to cache.
    const prefetched = page.waitForEvent("requestfinished", {
      predicate: (request) =>
        matchesDestination(request, destination) &&
        request.headers()["rsc"] === "1" &&
        request.headers()["next-router-prefetch"] === "2" &&
        request.headers()["next-router-segment-prefetch"] === undefined,
    });
    if (testInfo.project.name.startsWith("mobile"))
      await lessonLink.dispatchEvent("touchstart");
    else await lessonLink.hover();
    const prefetchRequest = await prefetched;
    const response = await prefetchRequest.response();
    if (response === null) throw new Error("Finished prefetch has no response");
    const bytes = await response.body();
    const headers = response.headers();
    await testInfo.attach("intent-prefetch-response", {
      body: bytes,
      contentType: "application/octet-stream",
    });
    await testInfo.attach("intent-prefetch-metadata", {
      body: JSON.stringify(
        {
          href,
          requestUrl: prefetchRequest.url(),
          requestHeaders: prefetchRequest.headers(),
          status: response.status(),
          firstByte: bytes.subarray(0, 1).toString(),
          byteLength: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          headers: Object.fromEntries(
            [
              "content-type",
              "x-nextjs-stale-time",
              "x-nextjs-rewritten-path",
              "x-nextjs-rewritten-query",
              "vary",
            ].map((name) => [name, headers[name] ?? null]),
          ),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    expect(response.status()).toBe(200);
    expect(headers["x-nextjs-stale-time"]).toBe("60");
    expect(headers["content-type"]).toContain("text/x-component");

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (
        matchesDestination(request, destination) &&
        request.headers()["rsc"] === "1" &&
        request.headers()["next-router-prefetch"] === undefined
      ) {
        heldNavigationRequests.push(request.url());
        await navigationGate.promise;
      }
      await route.continue();
    });
    await page.evaluate((href) => {
      const observation = window.__intentCacheAdmission;
      if (observation === undefined)
        throw new Error("Reader DOM observation is missing");
      observation.destination = href;
      observation.started = true;
    }, destination.toString());
    await lessonLink.click();
    await expect(page).toHaveURL(destination.toString());
    const reader = page.locator(
      "[data-application-content] [data-material-reader-state='available']:visible",
    );
    await expect(
      reader.getByRole("heading", { level: 1, name: "Второй бесплатный урок" }),
    ).toBeVisible();
    await expect(
      reader
        .locator("[data-reader-body]")
        .getByText(/Открытый текст/u)
        .first(),
    ).toBeVisible();
    const course = page.locator("[data-course-reading-host]");
    const programmeButton = course.getByRole("button", {
      name: "Вся программа",
      exact: true,
    });
    const mobile = await programmeButton.isVisible();
    await expect(
      mobile
        ? reader
            .getByRole("navigation", { name: "Хлебные крошки" })
            .getByRole("link")
            .first()
        : course.getByRole("link", { name: "Вся программа", exact: true }),
    ).toHaveAttribute("href", `${programme}?page=1&at=navigation-lesson-2`);
    expect(
      await page.evaluate((): unknown => {
        const observation = window.__intentCacheAdmission;
        if (observation === undefined)
          throw new Error("Reader DOM observation is missing");
        return observation.sawReaderSkeleton;
      }),
      "The completed intent response supplies the visible Reader while navigation is held",
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        window.__intentCacheAdmission?.postClickRequests.filter(
          (request) => request.prefetch !== null,
        ),
      ),
      "No second intent response can supply the Reader after click",
    ).toEqual([]);
  } finally {
    try {
      await testInfo.attach("intent-navigation-observation", {
        body: JSON.stringify(
          {
            heldNavigationRequests,
            observation: await page.evaluate(() => {
              const observation = window.__intentCacheAdmission;
              if (observation === undefined)
                throw new Error("Reader DOM observation is missing");
              observation.restore();
              return {
                href: window.location.href,
                started: observation.started,
                sawReaderSkeleton: observation.sawReaderSkeleton,
                postClickRequests: observation.postClickRequests,
                shellResponses: observation.shellResponses,
              };
            }),
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      navigationGate.resolve(undefined);
      await page.unrouteAll({ behavior: "wait" });
    }
  }
});
