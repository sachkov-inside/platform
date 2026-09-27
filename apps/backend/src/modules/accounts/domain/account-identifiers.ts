import { randomUUID } from "node:crypto";

import { z } from "zod";

const accountIdSchema = z.uuid().brand<"AccountId">();

export type AccountId = z.output<typeof accountIdSchema>;

export function newAccountId(): AccountId {
  return accountIdSchema.parse(randomUUID());
}

export function accountId(value: string): AccountId {
  const parsed = parseAccountId(value);
  if (parsed === undefined) {
    throw new TypeError("AccountId must be a UUID");
  }
  return parsed;
}

export function parseAccountId(value: unknown): AccountId | undefined {
  const result = accountIdSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
