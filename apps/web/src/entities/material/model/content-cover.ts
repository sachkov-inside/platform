import { z } from "zod";

export const contentCoverSchema = z
  .object({
    coverId: z.uuid(),
    renditions: z.array(
      z
        .object({
          height: z.number().int().positive(),
          width: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

export type ContentCover = z.infer<typeof contentCoverSchema>;

export function contentCoverUrl(coverId: string, width: number): string {
  return `/api/content-covers/${encodeURIComponent(coverId)}/${String(width)}`;
}
