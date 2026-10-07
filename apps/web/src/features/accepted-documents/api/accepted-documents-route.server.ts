import "server-only";

import { requestLegalAcceptances } from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import { acceptedDocumentsSchema } from "../model/accepted-documents";

/** Журнал принятия владельца аккаунта для блока «Принятые документы». */
export async function handleAcceptedDocumentsRequest(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    try {
      const result = await requestLegalAcceptances(accessToken);
      if (!result.ok)
        return new Response(null, {
          status: result.response.status === 401 ? 401 : 503,
        });
      const parsed = acceptedDocumentsSchema.safeParse(result.body);
      return parsed.success
        ? Response.json({ documents: parsed.data.documents })
        : new Response(null, { status: 502 });
    } catch {
      return new Response(null, { status: 503 });
    }
  });
}
