import { z } from "zod";

export {
  materialId,
  type MaterialId,
} from "../../../infrastructure/contracts/material-id.js";

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .brand<"IdempotencyKey">();

export type IdempotencyKey = z.output<typeof idempotencyKeySchema>;

export function materialIdempotencyKey(value: string): IdempotencyKey {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("IdempotencyKey must contain 1 to 200 characters");
  }
  return parsed.data;
}
