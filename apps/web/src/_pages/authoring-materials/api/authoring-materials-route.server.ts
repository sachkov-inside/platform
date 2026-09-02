import "server-only";

import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getAuthoringMaterials } from "./get-authoring-materials";
import { parseAuthoringMaterialsUrlSearchParams } from "../model/authoring-materials-query";

const privateHeaders = { "cache-control": "private, no-store" } as const;

export async function handleAuthoringMaterialsRequest(
  request: Request,
): Promise<Response> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return Response.json(
      error instanceof LogtoSessionUnavailableError
        ? { kind: "signed_out" }
        : { kind: "unavailable", reference: "authoring-session" },
      { headers: privateHeaders },
    );
  }

  const query = parseAuthoringMaterialsUrlSearchParams(
    new URL(request.url).searchParams,
  );
  return Response.json(await getAuthoringMaterials(query, accessToken), {
    headers: privateHeaders,
  });
}
