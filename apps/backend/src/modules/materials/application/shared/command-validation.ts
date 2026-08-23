import { z } from "zod";

import { validationIssuePath } from "../../domain/material-document/validation-issue-path.js";
import type { ApplicationResult } from "../content-authoring.interface.js";

export const principalId = z.uuid().transform((value) => value.toLowerCase());
export const entityId = z.uuid().transform((value) => value.toLowerCase());
export const idempotencyKey = z.string().trim().min(1).max(200);

export function parseCommand<Value>(
  schema: z.ZodType<Value>,
  input: unknown,
): ApplicationResult<Value> {
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
