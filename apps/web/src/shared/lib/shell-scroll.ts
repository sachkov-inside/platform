/**
 * Who scrolls the public shell. Below 64rem the document scrolls; from 64rem the shell's
 * `[data-application-content]` element scrolls and the document stays one viewport tall
 * (`apps/web/CODING_STANDARDS.md`). The breakpoint and the selector live only here: callers ask
 * this module for the position instead of deciding the scroll root themselves.
 *
 * Browser-only: call these functions from effects and event handlers.
 */

const desktopQuery = "(width >= 64rem)";
const contentSelector = "[data-application-content]";

function desktopMedia(): MediaQueryList {
  return window.matchMedia(desktopQuery);
}

/**
 * The shell content element. A `scope` inside or around one shell picks that shell, so a page
 * that renders several shells (a Storybook docs page) reaches the right one.
 */
function shellContent(scope: ParentNode = document): HTMLElement | null {
  return (
    (scope instanceof Element
      ? scope.closest<HTMLElement>(contentSelector)
      : null) ?? scope.querySelector<HTMLElement>(contentSelector)
  );
}

/** The current vertical scroll position of the shell. */
export function readShellScroll(): number {
  const content = desktopMedia().matches ? shellContent() : null;
  return content === null ? window.scrollY : content.scrollTop;
}

/** Both possible scroll roots, saved together so a later width can restore either one. */
export interface ShellScrollRoots {
  readonly windowY: number;
  readonly contentY: number;
}

/** Reads the document and the shell content positions, whatever the current width. */
export function readShellScrollRoots(scope?: ParentNode): ShellScrollRoots {
  return {
    windowY: window.scrollY,
    contentY: shellContent(scope)?.scrollTop ?? 0,
  };
}

/** Writes both roots back; the browser clamps the one that does not scroll at this width. */
export function scrollShellRootsTo(
  roots: ShellScrollRoots,
  scope?: ParentNode,
): void {
  window.scrollTo({ top: roots.windowY, behavior: "instant" });
  shellContent(scope)?.scrollTo({ top: roots.contentY, behavior: "instant" });
}

/** Returns both possible scroll roots to the top, whatever the current width. */
export function resetShellScroll(scope?: ParentNode): void {
  window.scrollTo({ top: 0, behavior: "instant" });
  shellContent(scope)?.scrollTo({ top: 0, behavior: "instant" });
}

/** Calls `listener` with `true` when the shell becomes desktop and `false` when it leaves it. */
export function subscribeShellBreakpoint(
  listener: (desktop: boolean) => void,
): () => void {
  const media = desktopMedia();
  const onChange = () => {
    listener(media.matches);
  };
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

/**
 * Writes `top` once the current scroll root can reach it: streamed content may still be growing.
 * Gives up after `timeoutMs` or on the reader's own touch, wheel, key or history navigation.
 * Returns a function that stops waiting; calling it after completion is harmless.
 */
export function restoreShellScroll(top: number, timeoutMs: number): () => void {
  const content = shellContent();
  if (content === null) return () => undefined;
  let frame = 0;
  const stop = () => {
    observer.disconnect();
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("keydown", stop);
    window.removeEventListener("popstate", stop);
  };
  const restore = () => {
    const root = desktopMedia().matches ? content : document.documentElement;
    const available = root.scrollHeight - root.clientHeight;
    if (available + 1 < top) return;
    if (root === content) content.scrollTo({ top, behavior: "instant" });
    else window.scrollTo({ top, behavior: "instant" });
    stop();
  };
  const observer = new ResizeObserver(() => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(restore);
  });
  const timer = window.setTimeout(stop, timeoutMs);
  observer.observe(content);
  if (content.firstElementChild !== null)
    observer.observe(content.firstElementChild);
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("keydown", stop);
  window.addEventListener("popstate", stop);
  // The next frame follows the route commit, so browser scroll anchoring cannot offset this write.
  frame = window.requestAnimationFrame(restore);
  return stop;
}

/**
 * Keeps the reading position when the width crosses 64rem and the scroll root changes. The shell
 * installs this once, after its content element mounts.
 */
export function keepShellScrollAcrossBreakpoint(): () => void {
  const content = shellContent();
  if (content === null) return () => undefined;
  const desktop = desktopMedia();
  let contentTop = content.scrollTop;
  let documentTop = window.scrollY;
  const rememberContent = () => {
    if (desktop.matches) contentTop = content.scrollTop;
  };
  const rememberDocument = () => {
    if (!desktop.matches) documentTop = window.scrollY;
  };
  const transfer = () => {
    // Layout can clamp the old scroll owner before the media-query event arrives.
    if (desktop.matches) {
      // A scroll in the new owner can precede this media-query event.
      // Preserve it instead of restoring the previous owner's older position.
      const top =
        content.scrollTop > 0
          ? content.scrollTop
          : window.scrollY > 0
            ? window.scrollY
            : documentTop;
      window.scrollTo({ top: 0, behavior: "instant" });
      content.scrollTo({ top, behavior: "instant" });
      contentTop = content.scrollTop;
    } else {
      const top = window.scrollY > 0 ? window.scrollY : contentTop;
      content.scrollTo({ top: 0, behavior: "instant" });
      window.scrollTo({ top, behavior: "instant" });
      documentTop = window.scrollY;
    }
  };
  content.addEventListener("scroll", rememberContent, { passive: true });
  window.addEventListener("scroll", rememberDocument, { passive: true });
  desktop.addEventListener("change", transfer);
  return () => {
    content.removeEventListener("scroll", rememberContent);
    window.removeEventListener("scroll", rememberDocument);
    desktop.removeEventListener("change", transfer);
  };
}
