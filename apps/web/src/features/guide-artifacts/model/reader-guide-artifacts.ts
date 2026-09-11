import { z } from "zod";

/**
 * One artifact as the reader of a Guide sees it. `availability` is the coarse
 * state the backend already decided through ContentAccess: a locked artifact
 * still shows its title and purpose, never its bytes or its external address.
 */
export const readerGuideArtifactSchema = z
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

export type ReaderGuideArtifact = z.infer<typeof readerGuideArtifactSchema>;

export const readerGuideArtifactListSchema = z
  .object({ artifacts: z.array(readerGuideArtifactSchema) })
  .strict();

/**
 * The artifact section never fails the Guide page: when its own dependency is
 * down the page keeps the programme and says the section could not be read.
 */
export type ReaderGuideArtifactsResult =
  | { readonly artifacts: readonly ReaderGuideArtifact[]; readonly kind: "ready" }
  | { readonly kind: "unavailable" };

export function readerGuideArtifactFileHref(
  guideId: string,
  artifact: ReaderGuideArtifact,
): string {
  return `/api/guides/${encodeURIComponent(guideId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/file?version=${String(artifact.version)}`;
}
