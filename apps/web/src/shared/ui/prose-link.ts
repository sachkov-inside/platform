/** Ordinary document links keep the same discoverable treatment after contextual routing. */
export const proseLinkClassName =
  "text-action underline decoration-current decoration-1 underline-offset-4 hover:text-action-hover hover:decoration-2";

/** Relative routes and same-origin web links keep the current tab. */
export function proseLinkTarget(href: string, origin?: string) {
  try {
    const url = new URL(href, "https://inside.local");
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin !== origin &&
      (/^https?:/iu.test(href.trim()) || href.trim().startsWith("//"))
    )
      return { target: "_blank", rel: "noopener noreferrer" } as const;
  } catch {
    // Invalid addresses retain the document's existing link behaviour.
  }
  return {};
}
