import { z } from "zod";

import { validationIssuePath } from "../../domain/material-body/validation-issue-path.js";
import type {
  InvalidContentError,
  Result,
} from "../material-authoring.interface.js";
import {
  materialId,
  materialIdempotencyKey,
  materialRevisionId,
} from "../../domain/material-identifiers.js";

export const principalId = z.uuid().transform((value) => value.toLowerCase());
export const entityId = z.uuid().transform((value) => value.toLowerCase());
export const materialIdSchema = z.uuid().transform(materialId);
export const materialRevisionIdSchema = z.uuid().transform(materialRevisionId);
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
