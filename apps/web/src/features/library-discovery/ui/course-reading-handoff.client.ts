"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type SetStateAction,
} from "react";

interface RailSelection {
  readonly key: string;
  readonly chapter: string;
  readonly choosing: boolean;
}
export interface CourseReadingHandoffStates {
  readonly rail: Map<string, RailSelection>;
  readonly references: Map<string, boolean>;
}
/** Only the first local-to-host transfer uses these snapshots; later steps stay in the host. */
export const CourseReadingHandoffContext = createContext<{
  readonly states: CourseReadingHandoffStates;
  readonly active: boolean;
} | null>(null);

function useHandoffState<T>(
  states: Map<string, T> | undefined,
  active: boolean,
  key: string,
  initial: T,
) {
  const [value, setValue] = useState<T>(() => states?.get(key) ?? initial);
  const update = useCallback(
    (action: SetStateAction<T>) => {
      setValue((previous) => {
        const next = action instanceof Function ? action(previous) : action;
        if (!active) states?.set(key, next);
        return next;
      });
    },
    [states, active, key],
  );
  return [value, update] as const;
}
export function useCourseRailSelection(key: string, initial: RailSelection) {
  const handoff = useContext(CourseReadingHandoffContext);
  return useHandoffState(
    handoff?.states.rail,
    handoff?.active ?? false,
    key,
    initial,
  );
}
export function useCourseReferenceExpansion(key: string) {
  const handoff = useContext(CourseReadingHandoffContext);
  return useHandoffState(
    handoff?.states.references,
    handoff?.active ?? false,
    key,
    false,
  );
}

interface FrameView {
  readonly focus: readonly number[] | null;
  readonly scroll: readonly {
    readonly path: readonly number[];
    readonly top: number;
    readonly left: number;
  }[];
  readonly open: boolean;
  readonly details: readonly {
    readonly path: readonly number[];
    readonly open: boolean;
  }[];
}
export type CourseReadingHandoffView = readonly (FrameView | null)[];
const regions =
  "[data-course-local-frame] > aside, [data-course-local-frame] > div > [data-course-programme]";

function visibleRegion(root: Element) {
  return (
    root.getClientRects().length > 0 ||
    [...root.querySelectorAll("button, dialog")].some(
      (node) => node.getClientRects().length > 0,
    )
  );
}

function pathTo(root: Element, element: Element): number[] {
  if (root === element) return [];
  const parent = element.parentElement;
  if (parent === null) throw new Error("Course control left its frame");
  return [...pathTo(root, parent), [...parent.children].indexOf(element)];
}
function atPath(root: Element, path: readonly number[]): Element | undefined {
  let node: Element | undefined = root;
  for (const index of path) node = node?.children[index];
  return node;
}

/** Capture browser-owned state before React removes the local controls. */
export function captureCourseReadingHandoff(
  host: HTMLElement | null,
): CourseReadingHandoffView {
  if (host === null) return [];
  return [...host.querySelectorAll(regions)]
    .filter(visibleRegion)
    .map((root) => ({
      focus:
        document.activeElement !== null && root.contains(document.activeElement)
          ? pathTo(root, document.activeElement)
          : null,
      scroll: [root, ...root.querySelectorAll("*")]
        .filter((node) => node.scrollTop !== 0 || node.scrollLeft !== 0)
        .map((node) => ({
          path: pathTo(root, node),
          top: node.scrollTop,
          left: node.scrollLeft,
        })),
      open: root.querySelector("dialog")?.open === true,
      details: [...root.querySelectorAll("details")].map((node) => ({
        path: pathTo(root, node),
        open: node.open,
      })),
    }));
}

export function restoreCourseReadingHandoff(
  root: HTMLElement,
  view: CourseReadingHandoffView,
) {
  const controls = [
    ...root.querySelectorAll(
      ":scope > aside, :scope > div > [data-course-programme]",
    ),
  ].filter(visibleRegion);
  for (const [index, frame] of view.entries()) {
    const region = controls[index];
    if (frame === null || region === undefined) continue;
    for (const detail of frame.details) {
      const node = atPath(region, detail.path);
      if (node instanceof HTMLDetailsElement) node.open = detail.open;
    }
    const dialog = region.querySelector("dialog");
    if (frame.open && dialog !== null && !dialog.open) {
      const trigger = [
        ...region.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"]'),
      ].find((node) => node.getClientRects().length > 0);
      trigger?.focus({ preventScroll: true });
      dialog.showModal();
    }
    if (frame.focus !== null) {
      const control = atPath(region, frame.focus);
      if (control instanceof HTMLElement)
        control.focus({ preventScroll: true });
    }
    for (const position of frame.scroll) {
      const node = atPath(region, position.path);
      if (node === undefined) continue;
      node.scrollTop = position.top;
      node.scrollLeft = position.left;
    }
  }
}
