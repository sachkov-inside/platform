import "server-only";
import { z } from "zod";
import type { BackendTransportResult } from "@/shared/api/backend/index.server";
import type { Result, Failure } from "../model/communications";
import { hasText } from "@/shared/lib/text";

/** Calls the communications backend and maps its answer to the operation result. */
export async function executeCommunications<O extends z.ZodType>(
  outputSchema: O,
  key: string | undefined,
  execute: () => Promise<BackendTransportResult>,
): Promise<Result<z.infer<O>>> {
  try {
    const result = await execute();
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
      envelope.data.value["status"] !== "ok" ||
      envelope.data.value["contractVersion"] !== "inside-communications-v1"
    )
      return { kind: "error", code: "unavailable" };
    const value =
      key === undefined
        ? {
            ...envelope.data.value,
            ...(hasText(envelope.data.botStartUrl)
              ? { botStartUrl: envelope.data.botStartUrl }
              : {}),
          }
        : key === "preview"
          ? {
              ...z
                .record(z.string(), z.unknown())
                .parse(envelope.data.value["preview"]),
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
