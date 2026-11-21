import {
  parseThemePreference,
  resolvesDark,
  systemDarkQuery,
  themeColors,
  themePreferenceStorageKey,
  type ThemePreference,
} from "../model/theme-preference";

const changeEvent = "inside:theme-preference";

// A failed write keeps the reader's choice in this document until another tab stores a newer one.
let unsavedChoice: ThemePreference | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(themePreferenceStorageKey);
  } catch {
    return null;
  }
}

function systemDark(): boolean {
  try {
    return matchMedia(systemDarkQuery).matches;
  } catch {
    return false;
  }
}

export function readThemePreference(): ThemePreference {
  return unsavedChoice ?? parseThemePreference(readStored());
}

/** The same steps as the inline restore script, for every later change of the theme. */
function applyTheme(preference: ThemePreference): void {
  const dark = resolvesDark(preference, systemDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta !== null) meta.content = dark ? themeColors.dark : themeColors.light;
}

export function chooseThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(themePreferenceStorageKey, preference);
    unsavedChoice = null;
  } catch {
    unsavedChoice = preference;
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(changeEvent));
}

/**
 * Keeps the page in step with the choice: another tab may change it, and «Как в системе» follows
 * the operating system while the page is open. The switch subscribes when it mounts and applies the
 * choice once: a layout that answers «не найдено» before its shell gets a document without the
 * inline restore script, and the client renders the page.
 */
export function subscribeThemePreference(onChange: () => void): () => void {
  applyTheme(readThemePreference());
  const sync = () => {
    applyTheme(readThemePreference());
    onChange();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== themePreferenceStorageKey && event.key !== null) return;
    unsavedChoice = null;
    sync();
  };
  let media: MediaQueryList | null = null;
  try {
    media = matchMedia(systemDarkQuery);
  } catch {
    media = null;
  }
  window.addEventListener("storage", storage);
  window.addEventListener(changeEvent, onChange);
  media?.addEventListener("change", sync);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(changeEvent, onChange);
    media?.removeEventListener("change", sync);
  };
}
