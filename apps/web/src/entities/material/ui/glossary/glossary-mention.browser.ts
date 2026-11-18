interface MentionSnapshot {
  readonly openness: "closed" | "hover" | "pinned";
  readonly expanded: boolean;
}

/** The 360px reading surface keeps a gutter around its definition. */
const VIEWPORT_GUTTER = 16;
/** The arrow occupies this gap without covering the next line of text. */
const BUBBLE_GAP = 12;
/** The arrow stays clear of the definition's rounded corners. */
const ARROW_INSET = 16;
const BUBBLE_MAX_WIDTH = 320;
/** A passing mouse does not open every term along its path. */
const HOVER_OPEN_DELAY_MS = 100;
/** The reader can cross from a term to its definition without losing it. */
const HOVER_CLOSE_DELAY_MS = 150;

/** Owns one term's hover/pinned facts and the live trigger/definition DOM pair. */
export function createGlossaryMention() {
  const initial: MentionSnapshot = { openness: "closed", expanded: false };
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let trigger: HTMLButtonElement | null = null;
  let bubble: HTMLDivElement | null = null;
  let clock: Window | null = null;
  let generation = 0;
  let openTimer: number | undefined;
  let closeTimer: number | undefined;
  let presentedTrigger: HTMLButtonElement | null = null;
  let presentedBubble: HTMLDivElement | null = null;
  let releasePresentation: (() => void) | undefined;

  const publish = (next: MentionSnapshot) => {
    if (
      snapshot.openness === next.openness &&
      snapshot.expanded === next.expanded
    )
      return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const cancelTimers = () => {
    clock?.clearTimeout(openTimer);
    clock?.clearTimeout(closeTimer);
    openTimer = undefined;
    closeTimer = undefined;
  };
  const close = () => {
    cancelTimers();
    publish({ openness: "closed", expanded: false });
  };
  const hoverOpen = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelTimers();
    if (snapshot.openness !== "closed" || trigger === null || clock === null)
      return;
    const anchor = trigger;
    const lifetime = generation;
    openTimer = clock.setTimeout(() => {
      openTimer = undefined;
      if (
        trigger !== anchor ||
        generation !== lifetime ||
        snapshot.openness !== "closed"
      )
        return;
      publish({ openness: "hover", expanded: false });
    }, HOVER_OPEN_DELAY_MS);
  };
  const hoverClose = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clock?.clearTimeout(openTimer);
    openTimer = undefined;
    if (snapshot.openness !== "hover" || trigger === null || clock === null)
      return;
    clock.clearTimeout(closeTimer);
    const anchor = trigger;
    const lifetime = generation;
    closeTimer = clock.setTimeout(() => {
      closeTimer = undefined;
      if (
        trigger === anchor &&
        generation === lifetime &&
        snapshot.openness === "hover"
      )
        close();
    }, HOVER_CLOSE_DELAY_MS);
  };
  const togglePinned = () => {
    if (trigger === null) return;
    cancelTimers();
    if (snapshot.openness === "pinned") close();
    else publish({ ...snapshot, openness: "pinned" });
  };

  const mountPresentation = (
    anchor: HTMLButtonElement,
    definition: HTMLDivElement,
  ) => {
    const document = anchor.ownerDocument;
    const view = document.defaultView;
    if (view === null) return;
    let active = true;
    const place = () => {
      if (!active || trigger !== anchor || bubble !== definition) return;
      const box = anchor.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const width = Math.min(BUBBLE_MAX_WIDTH, viewport - 2 * VIEWPORT_GUTTER);
      const left = Math.min(
        Math.max(box.left, VIEWPORT_GUTTER),
        viewport - VIEWPORT_GUTTER - width,
      );
      // Measure height at the final width; expanded text can wrap differently.
      definition.style.width = `${String(width)}px`;
      definition.style.left = `${String(left)}px`;
      const height = definition.offsetHeight;
      const above = box.top - BUBBLE_GAP - height;
      const below = box.bottom + BUBBLE_GAP;
      const fitsAbove = above >= VIEWPORT_GUTTER;
      const fitsBelow = below + height <= view.innerHeight - VIEWPORT_GUTTER;
      const side = fitsAbove || !fitsBelow ? "top" : "bottom";
      // Wrapped terms point at their first line, not the full multiline rectangle.
      const firstLine = anchor.getClientRects()[0] ?? box;
      const arrow = Math.min(
        Math.max(firstLine.left + firstLine.width / 2 - left, ARROW_INSET),
        width - ARROW_INSET,
      );
      const top = side === "top" ? Math.max(above, VIEWPORT_GUTTER) : below;
      definition.style.top = `${String(top)}px`;
      definition.setAttribute("data-side", side);
      const pointer = definition.querySelector<HTMLElement>(
        "[data-glossary-arrow]",
      );
      if (pointer !== null) pointer.style.left = `${String(arrow)}px`;
      definition.setAttribute("data-placed", "");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || event.key !== "Escape") return;
      close();
      if (trigger === anchor) anchor.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!active) return;
      const target = event.target;
      if (
        target instanceof Node &&
        (anchor.contains(target) || definition.contains(target))
      )
        return;
      close();
    };
    // Capture receives scrolls from the desktop shell's column as well as the window.
    const scrollOptions = { capture: true, passive: true } as const;
    const resize = new ResizeObserver(place);
    place();
    resize.observe(definition);
    document.addEventListener("scroll", place, scrollOptions);
    view.addEventListener("resize", place);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    definition.addEventListener("pointerenter", hoverOpen);
    definition.addEventListener("pointerleave", hoverClose);
    return () => {
      active = false;
      document.removeEventListener("scroll", place, scrollOptions);
      view.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      definition.removeEventListener("pointerenter", hoverOpen);
      definition.removeEventListener("pointerleave", hoverClose);
      resize.disconnect();
    };
  };
  const reconcilePresentation = () => {
    if (presentedTrigger === trigger && presentedBubble === bubble) return;
    releasePresentation?.();
    releasePresentation = undefined;
    presentedTrigger = trigger;
    presentedBubble = bubble;
    if (trigger !== null && bubble !== null)
      releasePresentation = mountPresentation(trigger, bubble);
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachTrigger: (element: HTMLButtonElement | null) => {
      if (element === null) return;
      cancelTimers();
      trigger = element;
      clock = element.ownerDocument.defaultView;
      const lifetime = ++generation;
      element.addEventListener("pointerenter", hoverOpen);
      element.addEventListener("pointerleave", hoverClose);
      element.addEventListener("click", togglePinned);
      reconcilePresentation();
      return () => {
        element.removeEventListener("pointerenter", hoverOpen);
        element.removeEventListener("pointerleave", hoverClose);
        element.removeEventListener("click", togglePinned);
        if (trigger !== element || generation !== lifetime) return;
        cancelTimers();
        trigger = null;
        clock = null;
        generation++;
        reconcilePresentation();
      };
    },
    attachBubble: (element: HTMLDivElement | null) => {
      if (element === null) return;
      bubble = element;
      reconcilePresentation();
      return () => {
        if (bubble !== element) return;
        bubble = null;
        reconcilePresentation();
      };
    },
    toggleExpanded: () => {
      if (trigger === null || bubble === null) return;
      cancelTimers();
      publish({ openness: "pinned", expanded: !snapshot.expanded });
    },
  };
}
