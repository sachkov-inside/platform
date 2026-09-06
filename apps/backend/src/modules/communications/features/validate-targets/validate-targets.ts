import type { z } from "zod";
import type { PublicContentTargets } from "../../../materials/index.js";
import type { partSchema } from "../../communications-schema.generated.js";
import type { targetErrorSchema } from "../../communications-contract.js";

export async function validateTargets(
  parts: z.infer<typeof partSchema>[],
  publicOrigin: string,
  targets: PublicContentTargets,
): Promise<z.infer<typeof targetErrorSchema>[]> {
  const origin = new URL(publicOrigin).origin;
  const urls = new Set<string>();
  for (const part of parts) {
    // Telegram also detects plain-text links without explicit entities.
    for (const match of part.content.text.matchAll(/https?:\/\/[^\s<>"']+/gu))
      urls.add(match[0].replace(/[),.!?;:]+$/u, ""));
    for (const button of part.content.buttons) urls.add(button.url);
    for (const entity of part.content.entities) {
      if (entity.type === "text_link" && entity.url) urls.add(entity.url);
      if (entity.type === "url")
        urls.add(
          part.content.text.slice(entity.offset, entity.offset + entity.length),
        );
    }
  }
  const errors: z.infer<typeof targetErrorSchema>[] = [];
  for (const value of urls) {
    const url = (() => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })();
    if (!url || url.origin !== origin) continue;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "materials" && segments[0] !== "series") continue;
    const slug = (() => {
      try {
        return segments.length === 2
          ? decodeURIComponent(segments[1] ?? "")
          : "";
      } catch {
        return "";
      }
    })();
    if (!slug || slug.length > 120) {
      errors.push({ url: value, reason: "not_found", targetId: null });
      continue;
    }
    const result = await targets.check({
      kind: segments[0] === "materials" ? "material" : "series",
      slug,
    });
    if (result.reason !== "eligible")
      errors.push({
        url: value,
        reason: result.reason,
        targetId: result.targetId,
      });
  }
  return errors;
}
