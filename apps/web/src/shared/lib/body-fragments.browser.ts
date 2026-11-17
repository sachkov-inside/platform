/** Longer than a browser's smooth scroll, so a later load or history jump is instant again. */
const smoothScrollSettleMs = 1000;

/** Owns fragment lookup, native navigation and temporary scroll policies for one mounted body. */
export function connectBodyFragments(marker: HTMLSpanElement | null) {
  const body = marker?.parentElement;
  if (body === null || body === undefined) return;
  // Only a followed same-page link animates; a load, a reload or history traversal jumps.
  let smooth = false;
  let smoothRoots: {
    readonly root: HTMLElement;
    readonly value: string;
    readonly priority: string;
  }[] = [];
  let settle: number | undefined;
  const releaseSmooth = () => {
    smooth = false;
    if (settle !== undefined) window.clearTimeout(settle);
    settle = undefined;
    for (const { root, value, priority } of smoothRoots) {
      if (value === "") root.style.removeProperty("scroll-behavior");
      else root.style.setProperty("scroll-behavior", value, priority);
    }
    smoothRoots = [];
  };
  /** `samePage`: the hash changed on this page; otherwise the page has just opened. */
  const navigate = (samePage: boolean) => {
    const behavior = smooth ? "smooth" : "instant";
    smooth = false;
    // Native activation still owns its animation; keep its CSS lease until the existing settle bound.
    if (behavior === "instant") releaseSmooth();
    if (body.getClientRects().length === 0 || window.location.hash === "") {
      releaseSmooth();
      return;
    }
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      id = window.location.hash.slice(1);
    }
    // On this page a media fragment such as a video chapter's `#t=90` addresses the player, not a
    // section; treating it as a missing section would throw the reader back to the top.
    if (samePage && id.includes("=")) {
      releaseSmooth();
      return;
    }
    const target =
      Array.from(body.querySelectorAll<HTMLElement>("[id]")).find(
        (element) => element.id === id,
      ) ?? body.ownerDocument.getElementById(id);
    if (target !== null) {
      for (
        let parent = target.parentElement;
        parent !== null && body.contains(parent);
        parent = parent.parentElement
      ) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      target.scrollIntoView({ block: "start", behavior });
    } else {
      for (
        let parent: HTMLElement | null = body;
        parent !== null;
        parent = parent.parentElement
      )
        parent.scrollTo({ top: 0, behavior: "instant" });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  };
  const followFragment = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (
      link === null ||
      link.hasAttribute("download") ||
      (link.target !== "" && link.target !== "_self")
    )
      return;
    const target = new URL(link.href);
    const current = new URL(window.location.href);
    if (target.hash === "" || target.origin !== current.origin) return;
    target.hash = "";
    current.hash = "";
    if (target.href !== current.href) return;
    releaseSmooth();
    // Without an animation the jump feels like opening another page.
    smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (smooth) {
      // The browser scrolls to the fragment before our handler runs; let that scroll animate too.
      for (
        let parent: HTMLElement | null = body;
        parent !== null;
        parent = parent.parentElement
      ) {
        smoothRoots.push({
          root: parent,
          value: parent.style.getPropertyValue("scroll-behavior"),
          priority: parent.style.getPropertyPriority("scroll-behavior"),
        });
        parent.style.setProperty("scroll-behavior", "smooth");
      }
      settle = window.setTimeout(releaseSmooth, smoothScrollSettleMs);
    }
    if (link.href !== window.location.href) return;
    // Preserve native same-fragment focus/history, then select the visible body synchronously (#2309).
    event.preventDefault();
    window.location.assign(link.href);
    navigate(true);
  };
  const followHash = () => {
    navigate(true);
  };
  navigate(false);
  body.addEventListener("click", followFragment);
  window.addEventListener("hashchange", followHash);
  return () => {
    releaseSmooth();
    body.removeEventListener("click", followFragment);
    window.removeEventListener("hashchange", followHash);
  };
}
