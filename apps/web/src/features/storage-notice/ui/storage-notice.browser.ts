import { storageNoticeKey } from "../model/storage-notice";

export interface StorageNoticeSnapshot {
  readonly stored: string | null;
  readonly fallbackEdition: number | null;
}

const listeners = new Set<() => void>();
let fallbackEdition: number | null = null;
let snapshot: StorageNoticeSnapshot = { stored: null, fallbackEdition: null };

function readStored(): string | null {
  try {
    return window.localStorage.getItem(storageNoticeKey);
  } catch {
    return null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key === storageNoticeKey || event.key === null) notify();
}

/** Native storage remains authoritative; failed persistence lasts only in this document. */
export function readStorageNoticeSnapshot(): StorageNoticeSnapshot {
  const stored = readStored();
  if (
    snapshot.stored !== stored ||
    snapshot.fallbackEdition !== fallbackEdition
  )
    snapshot = { stored, fallbackEdition };
  return snapshot;
}

export function subscribeStorageNotice(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function acknowledgeStorageNotice(edition: number) {
  try {
    window.localStorage.setItem(storageNoticeKey, String(edition));
    fallbackEdition = null;
  } catch {
    // The acknowledgement still hides this edition until the document reloads.
    fallbackEdition = edition;
  }
  notify();
}

/** The visible notice owns its measured page clearance, including retained-page cleanup. */
export function mountStorageNotice(element: HTMLElement | null) {
  if (element === null) return;
  const root = document.documentElement.style;
  const space = "--storage-notice-space";
  const clearance = "--storage-notice-clearance";
  let active = true;
  const measure = () => {
    if (!active) return;
    root.setProperty(space, `${String(element.offsetHeight)}px`);
    root.setProperty(
      clearance,
      "calc(var(--storage-notice-space) + var(--storage-notice-inset))",
    );
  };
  const observer = new ResizeObserver(measure);
  measure();
  observer.observe(element);
  return () => {
    active = false;
    observer.disconnect();
    root.removeProperty(clearance);
    root.removeProperty(space);
  };
}
