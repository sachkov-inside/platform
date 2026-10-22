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
  handleMutationOperation,
} from "@/shared/auth/index.server";
import {
  readContactSchema,
  startContactResultSchema,
  confirmContactResultSchema,
  contactFailureCodeSchema,
} from "../model/billing-contact";

import {
  confirmBillingContactOperation,
  startBillingContactOperation,
} from "./billing-contact.operation";

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
    // Backend authenticated this token. Receipt contact never establishes Account identity.
    let initialEmail: string | undefined;
    try {
      const claims = decodeJwt(token);
      const email = z
        .email()
        .max(254)
        .safeParse(
          claims["inside_receipt_email"] ?? claims["inside_verified_email"],
        );
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
  return handleMutationOperation(request, startBillingContactOperation, {
    invalidInput: () => ({ ok: false, code: "invalid_input" }) as const,
    execute: async (input, token) => {
      try {
        const result = startContactResultSchema.safeParse(
          mapResult(await requestStartBillingContact(input, token)),
        );
        return result.success
          ? result.data
          : ({ ok: false, code: "unavailable" } as const);
      } catch {
        return { ok: false, code: "unavailable" } as const;
      }
    },
  });
}
export function handleConfirmBillingContact(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, confirmBillingContactOperation, {
    invalidInput: () => ({ ok: false, code: "invalid_input" }) as const,
    execute: async (input, token) => {
      try {
        const result = confirmContactResultSchema.safeParse(
          mapResult(await requestConfirmBillingContact(input, token)),
        );
        return result.success
          ? result.data
          : ({ ok: false, code: "unavailable" } as const);
      } catch {
        return { ok: false, code: "unavailable" } as const;
      }
    },
  });
}
