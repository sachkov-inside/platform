declare global {
  interface Window {
    __isAppShellPrefetch(headers: Headers): boolean;
    __completedAppShellPrefetches: string[];
  }
}

/** Install before navigation; fetch observers call this after all init scripts have run.
 * The function is self-contained because Playwright serializes it into the page.
 */
export function installAppShellPrefetchClassifier() {
  window.__isAppShellPrefetch = (headers) => {
    if (headers.get("rsc") !== "1") return false;
    const mode = headers.get("next-router-prefetch");
    const segment = headers.get("next-router-segment-prefetch");
    // Next 16.4 can serve a static page shell directly, without a RuntimeShell request.
    // A route tree or layout segment does not complete the destination page shell.
    return (
      (mode === "3" && segment === null) ||
      (mode === "1" && segment?.endsWith("/__PAGE__") === true)
    );
  };
}
import { expect, type Page } from "@playwright/test";

/** Install before navigation. A reload starts a new completion ledger with the new document. */
export async function observeAppShellPrefetch(
  page: Page,
  pathnamePrefix: string,
) {
  await page.addInitScript(installAppShellPrefetchClassifier);
  await page.addInitScript(() => {
    const completed: string[] = [];
    window.__completedAppShellPrefetches = completed;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const response = nativeFetch(input, init);
      if (window.__isAppShellPrefetch(headers)) {
        void response
          .then(async (answer) => {
            await answer.clone().arrayBuffer();
            if (answer.ok) completed.push(new URL(answer.url).pathname);
          })
          .catch(() => undefined);
      }
      return response;
    };
  });
  return {
    async ready() {
      await expect
        .poll(() =>
          page.evaluate(
            (prefix) =>
              window.__completedAppShellPrefetches.some((path) =>
                path.startsWith(prefix),
              ),
            pathnamePrefix,
          ),
        )
        .toBe(true);
    },
  };
}
