import "server-only";

import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import { getAuthoringMaterials } from "./get-authoring-materials";
import { parseAuthoringMaterialsUrlSearchParams } from "../model/authoring-materials-query";

export async function handleAuthoringMaterialsRequest(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const query = parseAuthoringMaterialsUrlSearchParams(
      new URL(request.url).searchParams,
    );
    return Response.json(await getAuthoringMaterials(query, accessToken));
  });
}
