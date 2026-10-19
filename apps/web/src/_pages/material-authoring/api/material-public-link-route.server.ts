import "server-only";

import { handleAuthenticatedRead } from "@/shared/auth/index.server";
import {
  publicPageUrl,
  readPublicSiteOrigin,
} from "@/shared/link-preview/index.server";

import { getMaterialPublicLink } from "./get-material-public-link.server";

export function handleMaterialPublicLink(
  materialId: string,
): Promise<Response> {
  return handleAuthenticatedRead(async (token) => {
    const result = await getMaterialPublicLink(materialId, token);
    if (result.kind === "rejected")
      return Response.json({ kind: "rejected" }, { status: result.status });
    return Response.json({
      url:
        result.path === null
          ? null
          : publicPageUrl(await readPublicSiteOrigin(), result.path),
    });
  });
}
