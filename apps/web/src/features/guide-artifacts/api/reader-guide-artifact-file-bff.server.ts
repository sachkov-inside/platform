import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestReaderGuideArtifactFile,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

/**
 * Same-origin delivery of one artifact file. The backend owns the access
 * decision, the protected redirect and the cache policy; this boundary only
 * carries the viewer's session and the requested version.
 */
export async function proxyReaderGuideArtifactFile(
  request: Request,
  input: { readonly artifactId: string; readonly guideId: string },
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
      await requestReaderGuideArtifactFile({
        ...(accessToken === undefined ? {} : { accessToken }),
        artifactId: input.artifactId,
        guideId: input.guideId,
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
