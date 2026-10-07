import { z } from "zod";

/**
 * One artifact as the reader of a Product sees it. `availability` is the coarse
 * state the backend already decided through ContentAccess: a locked artifact
 * still shows its title and purpose, never its bytes or its external address.
 */
export const readerProductArtifactSchema = z
  .object({
    artifactId: z.uuid(),
    availability: z.enum(["available", "locked"]),
    content: z.discriminatedUnion("kind", [
      z
        .object({
          contentType: z.string(),
          filename: z.string(),
          kind: z.literal("file"),
          size: z.number().int().positive(),
        })
        .strict(),
      z
        .object({ externalUrl: z.string().nullable(), kind: z.literal("link") })
        .strict(),
    ]),
    purpose: z.string(),
    title: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();

export type ReaderProductArtifact = z.infer<typeof readerProductArtifactSchema>;

export const readerProductArtifactListSchema = z
  .object({ artifacts: z.array(readerProductArtifactSchema) })
  .strict();

/**
 * The artifact section never fails the Product page: when its own dependency is
 * down the page keeps the programme and says the section could not be read.
 */
export type ReaderProductArtifactsResult =
  | {
      readonly artifacts: readonly ReaderProductArtifact[];
      readonly kind: "ready";
    }
  | { readonly kind: "unavailable" };

export function readerProductArtifactFileHref(
  productId: string,
  artifact: ReaderProductArtifact,
): string {
  return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/file?version=${String(artifact.version)}`;
}
