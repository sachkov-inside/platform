import "server-only";
import { z } from "zod";
import {
  requestBillingContact,
  requestStartBillingContact,
  requestConfirmBillingContact,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  readLogtoBffConfig,
  LogtoSessionUnavailableError,
  handleAuthenticatedMutation,
} from "@/shared/auth/index.server";
import {
  readContactSchema,
  startContactInputSchema,
  confirmContactInputSchema,
  startContactResultSchema,
  confirmContactResultSchema,
} from "../model/billing-contact";

function mapResult(result: BackendTransportResult): unknown {
  if (result.ok) return result.body;
  const problem = z.object({ code: z.string() }).safeParse(result.problem);
  return {
    ok: false,
    code:
      result.response.status === 401
        ? "unauthorized"
        : problem.success
          ? problem.data.code
          : "unavailable",
  };
}
export async function handleReadBillingContact(): Promise<Response> {
  const headers = { "cache-control": "private, no-store", vary: "cookie" };
  try {
    const token = await getPlatformAccessToken(readLogtoBffConfig());
    const result = await requestBillingContact(token);
    if (!result.ok)
      return Response.json(mapResult(result), {
        headers,
        status: result.response.status,
      });
    const parsed = readContactSchema.safeParse(result.body);
    return parsed.success
      ? Response.json(parsed.data, { headers })
      : new Response(null, { headers, status: 502 });
  } catch (error) {
    return new Response(null, {
      headers,
      status: error instanceof LogtoSessionUnavailableError ? 401 : 503,
    });
  }
}
export function handleStartBillingContact(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = startContactInputSchema.safeParse({
      ...Object.fromEntries(form),
      expectedRevision: form.has("expectedRevision")
        ? Number(form.get("expectedRevision"))
        : undefined,
    });
    if (!parsed.success) return { ok: false, code: "invalid_input" };
    try {
      const result = startContactResultSchema.safeParse(
        mapResult(await requestStartBillingContact(parsed.data, token)),
      );
      return result.success ? result.data : { ok: false, code: "unavailable" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}
export function handleConfirmBillingContact(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = confirmContactInputSchema.safeParse(
      Object.fromEntries(form),
    );
    if (!parsed.success) return { ok: false, code: "invalid_input" };
    try {
      const result = confirmContactResultSchema.safeParse(
        mapResult(await requestConfirmBillingContact(parsed.data, token)),
      );
      return result.success ? result.data : { ok: false, code: "unavailable" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}
