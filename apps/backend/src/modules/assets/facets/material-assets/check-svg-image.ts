import { checkSvgMarkup } from "@inside/material-blocks/svg-image";

export type SvgImageCheck =
  | Readonly<{
      ok: true;
      value: Readonly<{ body: Uint8Array; height: number; width: number }>;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: "image_decode_failed" | "unsafe_svg" }>;
    }>;

/**
 * Checks an uploaded SVG Material image with the allowlist Reader also applies before it puts the
 * markup into a page (#2025, #2041), and returns the file to store with its layout size.
 */
export function checkSvgImage(body: Uint8Array): SvgImageCheck {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    // Not a dependency failure: bytes that are not UTF-8 are not an SVG image.
    return { error: { code: "image_decode_failed" }, ok: false };
  }
  const checked = checkSvgMarkup(source);
  if (!checked.ok) return checked;
  const { height, markup, width } = checked.value;
  return {
    ok: true,
    value: { body: new TextEncoder().encode(markup), height, width },
  };
}
