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
    const state = await getAuthoringMaterials(query, accessToken);
    const status =
      state.kind === "signed_out"
        ? 401
        : state.kind === "forbidden"
          ? 403
          : state.kind === "unavailable"
            ? 503
            : state.kind === "malformed_response"
              ? 502
              : state.kind === "unexpected_error"
                ? 500
                : 200;
    return Response.json(state, {
      status,
      ...(state.kind === "unavailable" || state.kind === "unexpected_error"
        ? { headers: { "x-correlation-id": state.reference } }
        : {}),
    });
  });
}
