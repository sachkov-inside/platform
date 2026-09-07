import { z } from "zod";

export const materialFormatSchema = z.enum(["video", "guide", "note"]);
export type MaterialFormat = z.infer<typeof materialFormatSchema>;
