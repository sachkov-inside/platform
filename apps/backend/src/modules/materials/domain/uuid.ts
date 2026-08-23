import { z } from "zod";

export const normalizedUuidSchema = z
  .uuid()
  .transform((value) => value.toLowerCase());

export function isUuid(value: unknown): value is string {
  return normalizedUuidSchema.safeParse(value).success;
}
