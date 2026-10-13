import "server-only";
import { z } from "zod";
import { decodeJwt } from "jose";
import {
  requestBillingContact,
  requestStartBillingContact,
  requestConfirmBillingContact,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedRead,
  handleAuthenticatedMutation,
} from "@/shared/auth/index.server";
import {
  readContactSchema,
  startContactInputSchema,
  confirmContactInputSchema,
  startContactResultSchema,
  confirmContactResultSchema,
  contactFailureCodeSchema,
} from "../model/billing-contact";

function mapResult(result: BackendTransportResult): unknown {
  if (result.ok) return result.body;
  const problem = z
    .object({ code: contactFailureCodeSchema })
    .safeParse(result.problem);
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
  return handleAuthenticatedRead(async (token) => {
    const result = await requestBillingContact(token);
    if (!result.ok)
      return Response.json(mapResult(result), {
        status: result.response.status,
      });
    const parsed = readContactSchema.safeParse(result.body);
    if (!parsed.success) return new Response(null, { status: 502 });
    // Backend authenticated this token. The claim only prefills an editable field;
    // it neither creates a billing contact nor decides Account ownership here.
    let initialEmail: string | undefined;
    try {
      const email = z
        .email()
        .max(254)
        .safeParse(decodeJwt(token)["inside_verified_email"]);
      if (email.success) initialEmail = email.data;
    } catch {
      // Telegram sessions and opaque tokens can have no email presentation.
    }
    return Response.json({
      ...parsed.data,
      ...(initialEmail === undefined ? {} : { initialEmail }),
    });
  });
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
