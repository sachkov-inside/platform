import { randomUUID } from "node:crypto";

import { z } from "zod";

const profileAvatarIdSchema = z.uuid().brand<"ProfileAvatarId">();

export type ProfileAvatarId = z.output<typeof profileAvatarIdSchema>;

export function newProfileAvatarId(): ProfileAvatarId {
  return profileAvatarIdSchema.parse(randomUUID());
}

export function parseProfileAvatarId(
  value: unknown,
): ProfileAvatarId | undefined {
  const result = profileAvatarIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
