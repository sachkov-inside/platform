import { z } from "zod";

export const authoringSourceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  path: z.string().min(1).max(1000).refine(
    (value) => !value.startsWith("/") && !/^[A-Za-z]:/u.test(value) && !value.includes("\\") && !value.split("/").includes("..") && !Array.from(value).some((character) => character.charCodeAt(0) < 32),
    "Expected a relative source path",
  ),
  revision: z.hash("sha256"),
  showInFeed: z.boolean(),
}).strict();

export type AuthoringSource = z.infer<typeof authoringSourceSchema>;
