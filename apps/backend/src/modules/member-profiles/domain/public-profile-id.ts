import { randomUUID } from "node:crypto";

import { z } from "zod";

declare const publicProfileIdBrand: unique symbol;
export type PublicProfileId = string & {
  readonly [publicProfileIdBrand]: true;
};

export function newPublicProfileId(): PublicProfileId {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return randomUUID() as PublicProfileId;
}

export function parsePublicProfileId(
  value: unknown,
): PublicProfileId | undefined {
  const result = z.uuid().safeParse(value);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return result.success ? (result.data as PublicProfileId) : undefined;
}
