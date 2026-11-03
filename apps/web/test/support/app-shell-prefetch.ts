declare global {
  interface Window {
    __isAppShellPrefetch(headers: Headers): boolean;
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

/** Register before navigation; links can share a completed shell with other destinations in this route. */
export async function observeAppShellPrefetch(
  page: Page,
  pathnamePrefix: string,
) {
  await page.addInitScript(installAppShellPrefetchClassifier);
  const ready = page
    .waitForResponse(async (response) => {
      const headers = response.request().headers();
      if (
        headers["rsc"] !== "1" ||
        !new URL(response.url()).pathname.startsWith(pathnamePrefix)
      )
        return false;
      return page.evaluate(
        (requestHeaders) =>
          window.__isAppShellPrefetch(new Headers(requestHeaders)),
        headers,
      );
    })
    .then(async (response) => {
      expect(response.ok()).toBe(true);
      expect(await response.finished()).toBeNull();
    });
  return { ready };
}
