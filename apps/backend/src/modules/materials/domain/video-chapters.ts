import { videoChaptersSchema } from "@inside/material-blocks";
import type { z } from "zod";

export { videoChaptersSchema };
export type VideoChapter = z.infer<typeof videoChaptersSchema>[number];
