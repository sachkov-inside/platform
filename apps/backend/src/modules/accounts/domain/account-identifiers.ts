import { randomUUID } from "node:crypto";

import { z } from "zod";

declare const accountIdBrand: unique symbol;
export type AccountId = string & { readonly [accountIdBrand]: true };

export function newAccountId(): AccountId {
  // This is the single constructor for UUIDs produced by the trusted runtime.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return randomUUID() as AccountId;
}

export function accountId(value: string): AccountId {
  const parsed = parseAccountId(value);
  if (parsed === undefined) {
    throw new TypeError("AccountId must be a UUID");
  }
  return parsed;
}

export function parseAccountId(value: unknown): AccountId | undefined {
  const result = z.uuid().safeParse(value);
  // Zod is the checked boundary for values read from storage or transport.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return result.success ? (result.data as AccountId) : undefined;
}
