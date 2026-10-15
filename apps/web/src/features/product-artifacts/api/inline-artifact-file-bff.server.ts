import "server-only";
import {
  backendProxyProblem,
  copyBackendResponse,
  requestReaderProductArtifactFile,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";
import { inlineArtifactReferenceSchema } from "../model/inline-artifact";
import { readReaderProductArtifacts } from "./read-reader-product-artifacts.server";

/** Resolve the current source version, then reuse the existing protected delivery decision. */
export async function downloadInlineArtifact(
  request: Request,
  input: { readonly productId: string; readonly sourceId: string },
): Promise<Response> {
  const parsed = inlineArtifactReferenceSchema.safeParse(input);
  if (!parsed.success)
    return backendProxyProblem(404, "artifact_not_found", "Artifact not found");
  try {
    const accessToken = await getOptionalPlatformAccessToken(request);
    const result = await readReaderProductArtifacts(
      input.productId,
      accessToken,
    );
    if (result.kind === "unavailable")
      return backendProxyProblem(
        503,
        "dependency_unavailable",
        "Artifact delivery is unavailable",
      );
    const artifact = result.artifacts.find(
      (item) => item.sourceId === input.sourceId,
    );
    if (
      artifact?.availability !== "available" ||
      artifact.content.kind !== "file"
    )
      return backendProxyProblem(
        404,
        "artifact_not_found",
        "Artifact not found",
      );
    return copyBackendResponse(
      await requestReaderProductArtifactFile({
        productId: input.productId,
        artifactId: artifact.artifactId,
        version: artifact.version,
        preview: false,
        ...(accessToken === undefined ? {} : { accessToken }),
        signal: request.signal,
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
