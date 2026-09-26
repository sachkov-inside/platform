import "server-only";

import { requestLegalAcceptances } from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { acceptedDocumentsSchema } from "../model/accepted-documents";

const privateHeaders = { "cache-control": "no-store, private" };

/** Журнал принятия владельца аккаунта для блока «Принятые документы». */
export async function handleAcceptedDocumentsRequest(): Promise<Response> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return new Response(null, {
      headers: privateHeaders,
      status: error instanceof LogtoSessionUnavailableError ? 401 : 503,
    });
  }
  try {
    const result = await requestLegalAcceptances(accessToken);
    if (!result.ok)
      return new Response(null, {
        headers: privateHeaders,
        status: result.response.status === 401 ? 401 : 503,
      });
    const parsed = acceptedDocumentsSchema.safeParse(result.body);
    return parsed.success
      ? Response.json(
          { documents: parsed.data.documents },
          { headers: privateHeaders },
        )
      : new Response(null, { headers: privateHeaders, status: 502 });
  } catch {
    return new Response(null, { headers: privateHeaders, status: 503 });
  }
}
