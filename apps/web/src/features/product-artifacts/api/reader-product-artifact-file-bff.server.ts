import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestReaderProductArtifactFile,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

/**
 * Same-origin delivery of one artifact file. The backend owns the access
 * decision, the protected redirect and the cache policy; this boundary only
 * carries the viewer's session and the requested version.
 */
export async function proxyReaderProductArtifactFile(
  request: Request,
  input: { readonly artifactId: string; readonly productId: string },
): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const preview = query.get("preview");
  const version = Number(query.get("version"));
  if (
    !Number.isInteger(version) ||
    version < 1 ||
    (preview !== null && preview !== "false" && preview !== "true")
  ) {
    return backendProxyProblem(404, "artifact_not_found", "Artifact not found");
  }
  try {
    const accessToken = await getOptionalPlatformAccessToken(request);
    return copyBackendResponse(
      await requestReaderProductArtifactFile({
        ...(accessToken === undefined ? {} : { accessToken }),
        artifactId: input.artifactId,
        productId: input.productId,
        preview: preview === "true",
        signal: request.signal,
        version,
      }),
    );
  } catch {
    return backendProxyProblem(
      503,
      "dependency_unavailable",
      "Artifact delivery is unavailable",
    );
  }
}
