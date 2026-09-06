import "server-only";
import { z } from "zod";
import type { BackendTransportResult } from "@/shared/api/backend/index.server";
import type { Result, Failure } from "../model/communications";

export async function executeForm<I extends z.ZodType, O extends z.ZodType>(
  form: FormData,
  inputSchema: I,
  outputSchema: O,
  key: string | undefined,
  execute: (input: z.infer<I>) => Promise<BackendTransportResult>,
): Promise<Result<z.infer<O>>> {
  let raw: unknown;
  try {
    raw = JSON.parse(z.string().parse(form.get("input")));
  } catch {
    return { kind: "error", code: "invalid" };
  }
  const input = inputSchema.safeParse(raw);
  if (!input.success) return { kind: "error", code: "invalid" };
  try {
    const result = await execute(input.data);
    if (!result.ok) {
      const problem = z.object({ code: z.string() }).safeParse(result.problem);
      const codes: Record<string, Failure["code"]> = {
        forbidden: "forbidden",
        link_required: "link_required",
        revision_conflict: "conflict",
        operation_conflict: "conflict",
        invalid_input: "invalid",
        invalid_targets: "invalid",
        malformed: "invalid",
        unsupported_content: "invalid",
        not_found: "not_found",
        not_implemented: "not_implemented",
      };
      return {
        kind: "error",
        code:
          result.response.status === 401
            ? "unauthorized"
            : ((problem.success ? codes[problem.data.code] : undefined) ??
              "unavailable"),
      };
    }
    const envelope = z
      .object({
        ok: z.literal(true),
        value: z.record(z.string(), z.unknown()),
        botStartUrl: z.string().optional(),
        targetErrors: z.array(z.unknown()).optional(),
      })
      .safeParse(result.body);
    if (
      !envelope.success ||
      envelope.data.value.status !== "ok" ||
      envelope.data.value.contractVersion !== "inside-communications-v1"
    )
      return { kind: "error", code: "unavailable" };
    const value =
      key === undefined
        ? {
            ...envelope.data.value,
            ...(envelope.data.botStartUrl
              ? { botStartUrl: envelope.data.botStartUrl }
              : {}),
          }
        : key === "preview"
          ? {
              ...z
                .record(z.string(), z.unknown())
                .parse(envelope.data.value.preview),
              targetErrors: envelope.data.targetErrors ?? [],
            }
          : envelope.data.value[key];
    const parsed = outputSchema.safeParse(value);
    return parsed.success
      ? { kind: "ready", value: parsed.data }
      : { kind: "error", code: "unavailable" };
  } catch {
    return { kind: "error", code: "unavailable" };
  }
}
