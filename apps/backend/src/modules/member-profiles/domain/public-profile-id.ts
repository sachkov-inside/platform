import { randomUUID } from "node:crypto";

import { z } from "zod";

const publicProfileIdSchema = z.uuid().brand<"PublicProfileId">();

export type PublicProfileId = z.output<typeof publicProfileIdSchema>;

export function newPublicProfileId(): PublicProfileId {
  return publicProfileIdSchema.parse(randomUUID());
}

export function parsePublicProfileId(
  value: unknown,
): PublicProfileId | undefined {
  const result = publicProfileIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
