import { z } from "zod";

export const inlineArtifactReferenceSchema = z
  .object({
    productId: z.uuid(),
    sourceId: z
      .string()
      .max(200)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .strict();
export type InlineArtifactReference = z.infer<
  typeof inlineArtifactReferenceSchema
>;

/** Imported author links address a stable source, never a signed URL or a frozen version. */
export function readInlineArtifactReference(
  href: string,
): InlineArtifactReference | undefined {
  const match =
    /^\/api\/products\/([^/]+)\/artifact-sources\/([^/?#]+)\/file$/u.exec(href);
  if (match === null) return undefined;
  try {
    const result = inlineArtifactReferenceSchema.safeParse({
      productId: match[1],
      sourceId: decodeURIComponent(match[2] ?? ""),
    });
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
