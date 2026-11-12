// What a widget of profile 1 must not use (https://core.telegram.org/bots/widgets), as patterns
// over the built HTML. Every widget build test checks its HTML against the whole list.
export const WIDGET_PROFILE_1_FORBIDDEN: readonly (readonly [
  name: string,
  pattern: RegExp,
])[] = [
  ["color-mix()", /color-mix\(/],
  ["height-relative units", /\d(?:vh|dvh|svh|lvh)\b/],
  [":has()", /:has\(/],
  ["CSS nesting", /&[ .:>]/],
  ["scrolling", /overflow(?:-[xy])?:(?:auto|scroll)/],
  ["sticky positioning", /position:sticky/],
  ["text-shadow", /text-shadow/],
  ["line-clamp", /line-clamp/],
  ["focus selectors", /:focus/],
  ["network calls", /\bfetch\(|XMLHttpRequest|WebSocket/],
  ["external resources", /(?:src|href)=|url\(|@import|@font-face/],
  ["form controls", /<(?:input|select|textarea|form|label)\b/],
  ["dialogs", /\b(?:alert|confirm|prompt)\(/],
  ["Element.closest", /\.closest\(/],
];

/** CSS class names of the built HTML; some clients lowercase them in quirks mode. */
export function widgetClassNames(html: string): string[] {
  const css = /<style>(.*?)<\/style>/s.exec(html)?.[1] ?? "";
  return [
    ...new Set(
      [...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1] ?? ""),
    ),
  ];
}
