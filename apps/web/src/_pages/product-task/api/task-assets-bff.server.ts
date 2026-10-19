import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestProductTaskAssetDelivery,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

export async function proxyProductTaskAssetDelivery(
  request: Request,
  input: {
    readonly productSlug: string;
    readonly code: string;
    readonly assetId: string;
  },
): Promise<Response> {
  const width = new URL(request.url).searchParams.get("width");
  if (width !== null && !/^[1-9]\d{0,3}$/u.test(width))
    return backendProxyProblem(404, "asset_not_found", "Task asset not found");
  try {
    const accessToken = await getOptionalPlatformAccessToken(request);
    return copyBackendResponse(
      await requestProductTaskAssetDelivery({
        ...input,
        ...(width === null ? {} : { variantWidth: Number(width) }),
        ...(accessToken === undefined ? {} : { accessToken }),
        signal: request.signal,
      }),
    );
  } catch {
    return backendProxyProblem(
      503,
      "dependency_unavailable",
      "Task asset delivery is unavailable",
    );
  }
}
