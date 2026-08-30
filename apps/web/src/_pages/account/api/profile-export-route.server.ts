import "server-only";

import { requestMemberProfileExport } from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { parseProfileExport } from "./member-profile-contract";

export async function handleProfileExportRequest(): Promise<Response> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return new Response(null, {
      headers: privateHeaders(),
      status: error instanceof LogtoSessionUnavailableError ? 401 : 503,
    });
  }
  try {
    const result = await requestMemberProfileExport(accessToken);
    if (!result.ok) {
      return new Response(null, {
        headers: privateHeaders(),
        status: result.response.status === 404 ? 404 : 503,
      });
    }
    const payload = parseProfileExport(result.body);
    return Response.json(payload, {
      headers: {
        ...privateHeaders(),
        "content-disposition": 'attachment; filename="member-profile.json"',
      },
    });
  } catch {
    return new Response(null, { headers: privateHeaders(), status: 503 });
  }
}

function privateHeaders(): Record<string, string> {
  return { "cache-control": "no-store, private" };
}
