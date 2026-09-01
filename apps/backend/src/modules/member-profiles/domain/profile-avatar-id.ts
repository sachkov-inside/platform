import { randomUUID } from "node:crypto";

import { z } from "zod";

declare const profileAvatarIdBrand: unique symbol;
export type ProfileAvatarId = string & {
  readonly [profileAvatarIdBrand]: true;
};

export function newProfileAvatarId(): ProfileAvatarId {
  // This is the single constructor for UUIDs produced by the trusted runtime.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return randomUUID() as ProfileAvatarId;
}

export function parseProfileAvatarId(value: unknown): ProfileAvatarId | undefined {
  const result = z.uuid().safeParse(value);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return result.success ? (result.data as ProfileAvatarId) : undefined;
}
