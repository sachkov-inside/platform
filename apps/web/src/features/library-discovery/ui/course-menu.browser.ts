import {
  courseMenuAttribute,
  courseMenuStorageKey,
} from "../model/course-menu";

// A failed write keeps the reader's choice in this document until a newer persisted fact (#2404).
let unsavedChoice: {
  readonly collapsed: boolean;
  readonly stored: string | null | undefined;
} | null = null;

function readStoredChoice(): string | null | undefined {
  try {
    return localStorage.getItem(courseMenuStorageKey);
  } catch {
    return undefined;
  }
}

function readCollapsed(): boolean {
  const stored = readStoredChoice();
  if (unsavedChoice !== null) {
    if (
      stored === undefined ||
      unsavedChoice.stored === undefined ||
      stored === unsavedChoice.stored
    )
      return unsavedChoice.collapsed;
    unsavedChoice = null;
  }
  return stored === "collapsed";
}

function applyCollapsed(collapsed: boolean) {
  if (collapsed)
    document.documentElement.setAttribute(courseMenuAttribute, "collapsed");
  else document.documentElement.removeAttribute(courseMenuAttribute);
}

export function saveCourseMenuCollapsed(collapsed: boolean): void {
  applyCollapsed(collapsed);
  try {
    if (collapsed) localStorage.setItem(courseMenuStorageKey, "collapsed");
    else localStorage.removeItem(courseMenuStorageKey);
    unsavedChoice = null;
  } catch {
    unsavedChoice = { collapsed, stored: readStoredChoice() };
  }
}

/** CSS shows one control; focus stays in the frame that the reader just changed. */
export function changeCourseMenuFromControl(
  control: HTMLButtonElement,
  collapsed: boolean,
): void {
  saveCourseMenuCollapsed(collapsed);
  control
    .closest("[data-course-reading]")
    ?.querySelector<HTMLButtonElement>(
      collapsed ? "[data-course-menu-expand]" : "[data-course-menu-collapse]",
    )
    ?.focus();
}

/** Visible course menus acquire native updates; hiding releases only the lease, not the choice. */
export function mountCourseMenuStrip(strip: HTMLDivElement | null) {
  if (strip === null) return;
  applyCollapsed(readCollapsed());
  const sync = (event: StorageEvent) => {
    if (event.key !== courseMenuStorageKey && event.key !== null) return;
    unsavedChoice = null;
    applyCollapsed(readCollapsed());
  };
  window.addEventListener("storage", sync);
  return () => {
    window.removeEventListener("storage", sync);
  };
}
