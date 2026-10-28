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
