import "server-only";
import { z } from "zod";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";
import { loadOwnSubmissions } from "./load-product-task.server";

const querySchema = z
  .object({
    code: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .max(120),
    after: z.string().min(1).max(512).optional(),
  })
  .strict();

/** Shares the task page parser while the authenticated read boundary owns session failures. */
export function readTaskSubmissionsRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedRead(async (token) => {
    const query = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success)
      return Response.json({ kind: "invalid_input" }, { status: 400 });
    const result = await loadOwnSubmissions(
      query.data.code,
      token,
      query.data.after,
    );
    if (result.kind !== "ready")
      return Response.json(result, {
        status: result.kind === "guest" ? 401 : 503,
      });
    const { kind: _kind, continued: _continued, ...data } = result;
    return Response.json(data);
  });
}
