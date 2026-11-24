import { isDeepStrictEqual } from "node:util";
import { truncateText } from "../../shared/text.js";
import type { TemplateContent } from "./communications-contract.js";
import type { NativeMessageSource } from "./native-message-source.js";

export function nativeContent(
  archiveRef: string,
  sources: readonly NativeMessageSource[],
): TemplateContent {
  const text = truncateText(
    sources
      .map((source) => source.text)
      .filter(Boolean)
      .join("\n\n"),
    4096,
  );
  return {
    type: "native",
    text,
    entities: [],
    buttons: sources.length === 1 ? (sources[0]?.buttons ?? []) : [],
    nativeRef: archiveRef,
    nativeCount: sources.length,
    nativeLinks: [...new Set(sources.flatMap((source) => source.links))].sort(),
  };
}

export function matchesNativeContent(
  content: TemplateContent,
  sources: readonly NativeMessageSource[],
): boolean {
  if (content.type !== "native" || content.nativeRef === undefined)
    return false;
  const expected = nativeContent(content.nativeRef, sources);
  return (
    content.text === expected.text &&
    content.nativeCount === expected.nativeCount &&
    content.entities.length === 0 &&
    isDeepStrictEqual(content.nativeLinks, expected.nativeLinks)
  );
}
