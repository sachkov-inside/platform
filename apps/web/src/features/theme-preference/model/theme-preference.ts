/**
 * The reader's choice of colour theme. It lives in this browser only: a guest chooses too, and
 * the server renders every page the same. Without a choice the site stays light (owner decision
 * 21.11.2026, #2516); «Как в системе» follows the operating system while it stays chosen.
 */
export type ThemePreference = "light" | "dark" | "system";

export const themePreferences: readonly ThemePreference[] = [
  "light",
  "dark",
  "system",
];

export const themePreferenceLabels: Readonly<Record<ThemePreference, string>> =
  {
    light: "Светлая",
    dark: "Тёмная",
    system: "Как в системе",
  };

export const themePreferenceStorageKey = "inside.theme.v1";

export const systemDarkQuery = "(prefers-color-scheme: dark)";

/**
 * Browser chrome colour: `--background` of each theme in `app/globals.css`. The inline script needs
 * the literal before any stylesheet applies, so the value is repeated here; change both together.
 */
export const themeColors = { light: "#ffffff", dark: "#18191b" } as const;

export function parseThemePreference(
  stored: string | null | undefined,
): ThemePreference {
  return stored === "dark" || stored === "system" ? stored : "light";
}

export function resolvesDark(
  preference: ThemePreference,
  systemDark: boolean,
): boolean {
  return preference === "dark" || (preference === "system" && systemDark);
}

/**
 * Runs inline in `<head>` before the body is parsed, so a dark page never paints light first. It
 * must stay self-contained and never throw. It also owns the only `theme-color` tag (the browser
 * chrome colour on phones): a tag rendered by React would be duplicated on hydration and stay
 * light. `applyTheme` in the browser module repeats these steps for later changes.
 */
export const themeRestoreSource = `(function(){var p=null,s=false;try{p=localStorage.getItem(${JSON.stringify(
  themePreferenceStorageKey,
)})}catch(e){}try{s=matchMedia(${JSON.stringify(
  systemDarkQuery,
)}).matches}catch(e){}var d=p==="dark"||(p==="system"&&s),r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.name="theme-color";document.head.appendChild(m)}m.content=d?${JSON.stringify(
  themeColors.dark,
)}:${JSON.stringify(themeColors.light)}})()`;
