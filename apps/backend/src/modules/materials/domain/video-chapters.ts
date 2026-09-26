import { z } from "zod";

export const videoChaptersSchema = z
  .array(
    z
      .object({
        start: z.number().int().nonnegative(),
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
  )
  .max(200)
  .refine(
    (chapters) =>
      chapters.every(
        (chapter, index) =>
          index === 0 || chapter.start > (chapters[index - 1]?.start ?? -1),
      ),
    "Video chapters must have increasing timestamps",
  );
export type VideoChapter = z.infer<typeof videoChaptersSchema>[number];
