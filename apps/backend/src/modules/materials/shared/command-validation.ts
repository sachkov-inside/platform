import { z } from "zod";

import { validationIssuePath } from "../domain/material-body/validation-issue-path.js";
import type { Result } from "../result.js";
import type { InvalidContentError } from "../facets/material-authoring/material-authoring.contract.js";
import {
  materialId,
  materialIdempotencyKey,
  materialRevisionId,
} from "../domain/material-identifiers.js";
import { normalizedUuidSchema } from "../domain/uuid.js";

export const accountId = normalizedUuidSchema;
export const entityId = normalizedUuidSchema;
export const materialIdSchema = normalizedUuidSchema.transform(materialId);
export const materialRevisionIdSchema =
  normalizedUuidSchema.transform(materialRevisionId);
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform(materialIdempotencyKey);

export function parseCommand<Value>(
  schema: z.ZodType<Value>,
  input: unknown,
): Result<Value, InvalidContentError> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: parsed.error.issues
        .map((issue) => ({
          code: "invalid_command",
          path: validationIssuePath(issue.path),
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, 100),
    },
  };
}
