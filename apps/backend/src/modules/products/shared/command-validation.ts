import { z } from "zod";
import type { Result } from "../../../infrastructure/content-authoring/result.js";
import type { InvalidContentError } from "../../../infrastructure/content-authoring/authoring-errors.js";
export const accountId = z.uuid().transform((id) => id.toLowerCase());
export const entityId = accountId;
export const collectionSlug = z
  .string()
  .trim()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export function parseCommand<Value>(
  schema: z.ZodType<Value>,
  input: unknown,
): Result<Value, InvalidContentError> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: parsed.error.issues
        .map((issue) => ({
          code: "invalid_command",
          path:
            issue.path.length === 0
              ? ""
              : "/" + issue.path.map(String).join("/"),
        }))
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, 100),
    },
  };
}
