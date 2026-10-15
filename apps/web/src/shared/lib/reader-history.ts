import { z } from "zod";

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
  expanded: z.array(z.string()),
});
type Origin = z.infer<typeof originSchema>;
export const readerHistoryEntryEvent = "inside-reader-history-entry";
export const readerHistoryRestoreEvent = "inside-reader-history-restore";
let pending:
  { target: string; origin?: Origin; restoreFrom?: string } | undefined;
let activeEntryId: string | undefined;
let preservationInstalled = false;
export function resetReaderHistoryActivation() {
  activeEntryId = undefined;
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
    element.closest(
      "[data-material-id], [data-course-reading], [data-product-task]",
    ) ??
    element.parentElement ??
    element
  );
}
function contentScroller(root: ParentNode): Element | null {
  return (
    (root instanceof Element
      ? root.closest("[data-application-content]")
      : null) ?? root.querySelector("[data-application-content]")
  );
}

/** Positions belong to an individual browser history entry, never a last-course preference. */
export function saveReaderHistoryView(root: ParentNode = document) {
  const current = entry();
  if (current === undefined) return;
  const rail = root.querySelector<HTMLElement>("[data-course-rail-scroll]");
  const view = {
    href: window.location.href,
    windowY: window.scrollY,
    contentY: contentScroller(root)?.scrollTop ?? 0,
    railY: rail?.scrollTop ?? 0,
    chapter: root.querySelector<HTMLElement>("[data-course-chapter]")?.dataset[
      "courseChapter"
    ],
    expanded: Array.from(
      root.querySelectorAll<HTMLDetailsElement>(
        "details[data-course-chapter-id][open]",
      ),
      (item) => item.dataset["courseChapterId"] ?? "",
    ),
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
  if (activeEntryId === current.id && restoreFrom === undefined) return;
  activeEntryId = current.id;
  let raw: unknown;
  try {
    raw = JSON.parse(
      sessionStorage.getItem(key(restoreFrom ?? current.id)) ?? "null",
    );
  } catch {
    return;
  }
  const view = viewSchema.safeParse(raw).data;
  if (
    view === undefined ||
    (restoreFrom === undefined && view.href !== window.location.href)
  )
    return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (entry()?.id !== current.id || window.location.href !== current.href)
        return;
      window.dispatchEvent(
        new CustomEvent(readerHistoryRestoreEvent, { detail: view.chapter }),
      );
      root
        .querySelectorAll<HTMLDetailsElement>("details[data-course-chapter-id]")
        .forEach((item) => {
          item.open = view.expanded.includes(
            item.dataset["courseChapterId"] ?? "",
          );
        });
      requestAnimationFrame(() => {
        if (entry()?.id !== current.id || window.location.href !== current.href)
          return;
        window.scrollTo({ top: view.windowY, behavior: "instant" });
        contentScroller(root)?.scrollTo({
          top: view.contentY,
          behavior: "instant",
        });
        root
          .querySelector("[data-course-rail-scroll]")
          ?.scrollTo({ top: view.railY, behavior: "instant" });
      });
    }),
  );
}

/** Capture only an ordinary in-tab transition carrying a validated course anchor. */
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
  if (
    target.origin !== window.location.origin ||
    !target.pathname.startsWith("/materials/") ||
    !target.searchParams.has("anchor")
  )
    return;
  const current = entry();
  if (current === undefined) return;
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
