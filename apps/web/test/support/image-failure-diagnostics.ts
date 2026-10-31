import type { Page, Request, Response } from "@playwright/test";

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? `${url.protocol}//${url.host}${url.pathname}`.slice(0, 512)
      : "<unavailable>";
  } catch {
    return "<unavailable>";
  }
}

/** Observe image requests before navigation; retain only bounded, allowlisted fields.
 * @param {import("@playwright/test").Page} page
 */
export function observeImageFailure(page: Page) {
  const requests = new Map<
    Request,
    {
      id: number;
      url: string;
      redirectedFrom: number | null;
      state: string;
      status: number | null;
      observedAt: number;
    }
  >();
  let sequence = 0;
  const started = (request: Request) => {
    if (request.resourceType() !== "image") return;
    const previous = request.redirectedFrom();
    const redirectedFrom = previous
      ? (requests.get(previous)?.id ?? null)
      : null;
    const oldest = requests.keys().next().value;
    if (requests.size === 64 && oldest) requests.delete(oldest);
    requests.set(request, {
      id: ++sequence,
      url: safeUrl(request.url()),
      redirectedFrom,
      state: "pending",
      status: null,
      // deterministic-test-allow wall-clock: diagnostic event metadata, never an assertion or success signal.
      observedAt: Date.now(),
    });
  };
  const responded = (response: Response) => {
    const entry = requests.get(response.request());
    if (entry) {
      entry.status = response.status();
      entry.state = "response";
    }
  };
  const finished = (request: Request) => {
    const entry = requests.get(request);
    if (entry) entry.state = "finished";
  };
  const failed = (request: Request) => {
    const entry = requests.get(request);
    if (entry) entry.state = "failed";
  };
  page.on("request", started);
  page.on("response", responded);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);
  return {
    async snapshot() {
      const network = [...requests].map(([request, entry]) => ({
        ...entry,
        timing: request.timing(),
      }));
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const images = await Promise.race([
          page.evaluate(() =>
            Array.from(document.images)
              .slice(0, 32)
              .map((node) => {
                let currentSrc = "<unavailable>";
                try {
                  const url = new URL(node.currentSrc);
                  if (["http:", "https:"].includes(url.protocol))
                    currentSrc =
                      `${url.protocol}//${url.host}${url.pathname}`.slice(
                        0,
                        512,
                      );
                } catch {
                  /* Empty image sources have no URL. */
                }
                return {
                  currentSrc,
                  complete: node.complete,
                  naturalWidth: node.naturalWidth,
                };
              }),
          ),
          new Promise<null>((resolve) => {
            // deterministic-test-allow duration-wait: diagnostics must not block failure teardown.
            deadline = setTimeout(() => {
              resolve(null);
            }, 1000);
          }),
        ]);
        return {
          requests: network,
          images: images ?? [],
          imageState: images === null ? "unavailable" : "captured",
        };
      } catch {
        return { requests: network, images: [], imageState: "unavailable" };
      } finally {
        clearTimeout(deadline);
      }
    },
    dispose() {
      page.off("request", started);
      page.off("response", responded);
      page.off("requestfinished", finished);
      page.off("requestfailed", failed);
      requests.clear();
    },
  };
}
