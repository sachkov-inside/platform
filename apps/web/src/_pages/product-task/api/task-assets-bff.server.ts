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
  try {
    const accessToken = await getOptionalPlatformAccessToken(request);
    return copyBackendResponse(
      await requestProductTaskAssetDelivery({
        ...input,
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
