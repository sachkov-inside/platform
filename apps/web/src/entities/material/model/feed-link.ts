/** Only the already-public displayed text is inspected; no destination is fetched. */
export function feedLink(
  text: string,
  linkedHref?: string,
): { readonly href: string; readonly label: string } | undefined {
  if (linkedHref !== undefined) {
    const linked = parseFeedHref(linkedHref);
    if (linked !== undefined) return linked;
  }
  const matches = text.matchAll(/https?:\/\/[^\s<>"\u201c\u201d]+/gu);
  for (const [match] of matches) {
    let candidate = match.replace(/[.,!?;:\u00bb]+$/u, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
    ] as const) {
      while (
        candidate.endsWith(close) &&
        candidate.split(close).length > candidate.split(open).length
      )
        candidate = candidate.slice(0, -1);
    }
    const link = parseFeedHref(candidate);
    if (link !== undefined) return link;
  }
  return undefined;
}

function parseFeedHref(
  href: string,
): { readonly href: string; readonly label: string } | undefined {
  try {
    const url = new URL(href);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    )
      return undefined;
    return { href: url.href, label: url.hostname.replace(/^www\./u, "") };
  } catch {
    return undefined;
  }
}
