import { z } from "zod";

export interface ContentCover {
  readonly coverId: string;
  readonly renditions: readonly {
    readonly height: number;
    readonly width: number;
  }[];
}

export const contentCoverSchema: z.ZodType<ContentCover> = z
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

export function contentCoverUrl(coverId: string, width: number): string {
  return `/api/content-covers/${encodeURIComponent(coverId)}/${String(width)}`;
}
