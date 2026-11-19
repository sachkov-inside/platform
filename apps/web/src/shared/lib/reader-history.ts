import { z } from "zod";

import { readShellScrollRoots, scrollShellRootsTo } from "./shell-scroll";

const originSchema = z.object({ id: z.uuid(), href: z.url() });
const entrySchema = z.object({
  id: z.uuid(),
  href: z.url(),
  origin: originSchema.optional(),
});
const viewSchema = z.object({
  href: z.url(),
  windowY: z.number(),
  contentY: z.number(),
  railY: z.number(),
  chapter: z.string().optional(),
});
type Origin = z.infer<typeof originSchema>;
export const readerHistoryEntryEvent = "inside-reader-history-entry";
export const readerHistoryRestoreEvent = "inside-reader-history-restore";
let pending:
  { target: string; origin?: Origin; restoreFrom?: string } | undefined;
let activeEntryId: string | undefined;
let cancelPendingRestoration: () => void = () => undefined;
const mountedRails = new WeakMap<
  ParentNode,
  { readonly chapters: readonly string[] }
>();
let pendingRailRestoration:
  { readonly root: ParentNode; request(): void } | undefined;
let preservationInstalled = false;
export function resetReaderHistoryActivation() {
  cancelPendingRestoration();
  activeEntryId = undefined;
}
/** The mounted rail owns availability until its subscription disconnects (#2330). */
export function readerHistoryRailReady(
  root: ParentNode,
  availableChapters: readonly string[],
) {
  const owner = liveReaderRoot(root);
  const readiness = { chapters: [...availableChapters] };
  mountedRails.set(owner, readiness);
  if (pendingRailRestoration?.root === owner) pendingRailRestoration.request();
  return () => {
    if (mountedRails.get(owner) === readiness) mountedRails.delete(owner);
  };
}

const key = (id: string) => `inside-reader-entry:${id}`;

function entry() {
  return z.object({ insideReader: entrySchema }).safeParse(window.history.state)
    .data?.insideReader;
}
function state() {
  return (
    z.record(z.string(), z.unknown()).safeParse(window.history.state).data ?? {}
  );
}

/** A router refresh replaces its own state, but keeps the same browser history entry. */
function preserveReaderHistoryEntry() {
  if (preservationInstalled) return;
  preservationInstalled = true;
  // Reference links can be usable before their streamed page installs its Tracker.
  // Keep the existing origin across that gap without creating a new identity or view.
  document.addEventListener(
    "click",
    (event) => {
      if (entry()?.href === window.location.href) return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (link !== null)
        prepareReaderHistory(event, undefined, readerHistoryRoot(link));
    },
    true,
  );
  const replace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data: unknown, unused, url) => {
    const current = entry();
    const target = new URL(url ?? window.location.href, window.location.href)
      .href;
    const incoming = z.record(z.string(), z.unknown()).safeParse(data).data;
    replace(
      current !== undefined &&
        current.href === window.location.href &&
        target === current.href &&
        incoming?.["insideReader"] === undefined
        ? { ...incoming, insideReader: current }
        : data,
      unused,
      url,
    );
  };
}
function path(href: string) {
  return new URL(href, window.location.origin).pathname;
}

export function readerHistoryRoot(element: Element): Element {
  return (
    element.closest('[data-reader-history-rail="none"]') ??
    element.closest("[data-course-reading-host]") ??
    element.closest("[data-course-reading]") ??
    element.closest("[data-material-id], [data-product-task]") ??
    element.parentElement ??
    element
  );
}

function liveReaderRoot(root: ParentNode): ParentNode {
  return root instanceof Element ? readerHistoryRoot(root) : root;
}
function hasNoCourse(root: ParentNode): boolean {
  const selector = '[data-reader-history-rail="none"]';
  if (root instanceof Element) return root.matches(selector);
  return [...root.querySelectorAll(selector)].some(
    (node) => node.getClientRects().length > 0,
  );
}

/** Positions belong to an individual browser history entry, never a last-course preference. */
export function saveReaderHistoryView(root: ParentNode = document) {
  const current = entry();
  if (current === undefined || current.href !== window.location.href) return;
  root = liveReaderRoot(root);
  const rail = root.querySelector<HTMLElement>("[data-course-rail-scroll]");
  const view = {
    href: window.location.href,
    ...readShellScrollRoots(root),
    railY: rail?.scrollTop ?? 0,
    chapter: root.querySelector<HTMLElement>("[data-course-chapter]")?.dataset[
      "courseChapter"
    ],
  };
  try {
    sessionStorage.setItem(key(current.id), JSON.stringify(view));
  } catch {
    /* Navigation also works without storage. */
  }
}

export function enterReaderHistory(
  originHref?: string,
  root: ParentNode = document,
) {
  preserveReaderHistoryEntry();
  cancelPendingRestoration();
  let current = entry();
  if (current?.href !== window.location.href) current = undefined;
  const restoreFrom =
    pending?.target === window.location.href ? pending.restoreFrom : undefined;
  if (pending?.target === window.location.href) {
    current = {
      id: crypto.randomUUID(),
      href: window.location.href,
      ...(originHref !== undefined &&
      pending.origin !== undefined &&
      path(pending.origin.href) === path(originHref)
        ? { origin: pending.origin }
        : {}),
    };
    pending = undefined;
  }
  pending = undefined;
  current ??= { id: crypto.randomUUID(), href: window.location.href };
  window.history.replaceState({ ...state(), insideReader: current }, "");
  window.dispatchEvent(new Event(readerHistoryEntryEvent));
  // Home has no Reader tracker to observe Back. Release the departed entry on
  // disconnect, while a reconnect on the same address keeps its activation (#2480).
  const leave = () => {
    if (activeEntryId === current.id && window.location.href !== current.href)
      activeEntryId = undefined;
  };
  if (activeEntryId === current.id && restoreFrom === undefined) return leave;
  activeEntryId = current.id;
  let raw: unknown;
  try {
    raw = JSON.parse(
      sessionStorage.getItem(key(restoreFrom ?? current.id)) ?? "null",
    );
  } catch {
    return leave;
  }
  const view = viewSchema.safeParse(raw).data;
  if (
    view === undefined ||
    (restoreFrom === undefined && view.href !== window.location.href)
  )
    return leave;
  const anchor = root;
  let waitingForView = true;
  let observedRoot: ParentNode | undefined;
  const targetChapter = (scope: ParentNode) => {
    if (view.chapter === undefined || hasNoCourse(scope)) return undefined;
    const available = mountedRails.get(scope);
    return available !== undefined && !available.chapters.includes(view.chapter)
      ? undefined
      : view.chapter;
  };
  const stop = () => {
    release();
    if (!waitingForView) return;
    waitingForView = false;
    if (activeEntryId === current.id) activeEntryId = undefined;
  };
  const restore = () => {
    if (!waitingForView) return;
    if (entry()?.id !== current.id || window.location.href !== current.href) {
      stop();
      return;
    }
    const scope = liveReaderRoot(anchor);
    if (observedRoot !== scope) {
      observer.disconnect();
      observedRoot = scope;
      if (scope instanceof Node)
        observer.observe(scope, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: [
            "data-course-chapter",
            "data-course-reading",
            "data-course-reading-host",
            "data-reader-history-rail",
            "aria-busy",
            "hidden",
            "style",
          ],
        });
    }
    const requiredChapter = targetChapter(scope);
    const chapter = scope.querySelector<HTMLElement>("[data-course-chapter]");
    if (
      requiredChapter !== undefined &&
      (chapter === null || chapter.dataset["courseChapter"] !== requiredChapter)
    )
      return;
    // A desktop rail may be hidden while its reader is visible (#2330).
    const visible = scope instanceof Element ? scope : document.documentElement;
    if (visible.getClientRects().length === 0) return;
    // A Task's pending progress label can reflow its related Material card (#2330).
    // Restore after that concrete layout owner commits, before completing this lease.
    if (
      [
        ...scope.querySelectorAll(
          '[data-task-related-material][aria-busy="true"]',
        ),
      ].some((element) => element.getClientRects().length > 0)
    )
      return;
    scrollShellRootsTo(view, scope);
    if (!hasNoCourse(scope))
      scope
        .querySelector("[data-course-rail-scroll]")
        ?.scrollTo({ top: view.railY, behavior: "instant" });
    waitingForView = false;
    release();
  };
  const userScrollEvents = ["wheel", "touchmove", "keydown"] as const;
  const userScroll = (event: Event) => {
    if (!event.isTrusted) return;
    if (event instanceof KeyboardEvent) {
      if (
        ![
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) !== null
      )
        return;
    }
    const scope = liveReaderRoot(anchor);
    if (
      scope instanceof Node &&
      event.target instanceof Node &&
      scope.contains(event.target)
    )
      stop();
  };
  const observer = new MutationObserver(restore);
  const readiness = {
    get root() {
      return liveReaderRoot(anchor);
    },
    request: () => {
      window.dispatchEvent(
        new CustomEvent(readerHistoryRestoreEvent, {
          detail: targetChapter(liveReaderRoot(anchor)),
        }),
      );
      restore();
    },
  };
  const release = () => {
    observer.disconnect();
    for (const type of userScrollEvents)
      document.removeEventListener(type, userScroll, true);
    if (pendingRailRestoration === readiness)
      pendingRailRestoration = undefined;
    if (cancelPendingRestoration === stop)
      cancelPendingRestoration = () => undefined;
  };
  pendingRailRestoration = readiness;
  cancelPendingRestoration = stop;
  // A real reader scroll takes ownership while layout is still pending (#2330).
  for (const type of userScrollEvents)
    document.addEventListener(type, userScroll, {
      passive: true,
      capture: true,
    });
  readiness.request();
  return () => {
    stop();
    leave();
  };
}

/** Capture ordinary in-tab supplementary and same-document fragment transitions. */
export function prepareReaderHistory(
  event: MouseEvent,
  originHref?: string,
  root: ParentNode = document,
) {
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
  saveReaderHistoryView(root);
  const target = new URL(link.href);
  const fragment =
    target.hash !== "" &&
    target.pathname === window.location.pathname &&
    target.search === window.location.search;
  if (
    target.origin !== window.location.origin ||
    (!fragment &&
      (!target.pathname.startsWith("/materials/") ||
        !target.searchParams.has("anchor")))
  )
    return;
  const current = entry();
  if (current?.href !== window.location.href) {
    const origin =
      pending?.target === window.location.href ? pending.origin : undefined;
    if (origin !== undefined) pending = { target: target.href, origin };
    return;
  }
  const inherited = originHref === undefined ? undefined : current.origin;
  pending = {
    target: target.href,
    origin: inherited ?? { id: current.id, href: window.location.href },
  };
}

export function readerOriginHref(href: string): string | undefined {
  const origin = entry()?.origin;
  return origin !== undefined &&
    new URL(origin.href, window.location.origin).origin ===
      window.location.origin &&
    path(origin.href) === path(href)
    ? origin.href
    : undefined;
}

export function prepareReaderOriginReturn(
  href: string,
  root: ParentNode = document,
) {
  const origin = entry()?.origin;
  if (origin === undefined || path(origin.href) !== path(href)) return;
  saveReaderHistoryView(root);
  pending = {
    target: new URL(href, window.location.origin).href,
    restoreFrom: origin.id,
  };
}
