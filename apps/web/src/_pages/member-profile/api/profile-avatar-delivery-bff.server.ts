import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestProfileAvatarDelivery,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

export async function proxyProfileAvatarDelivery(
  request: Request,
  input: {
    readonly avatarId: string;
    readonly publicProfileId: string;
    readonly size: string;
  },
): Promise<Response> {
  try {
    const accessToken = await getOptionalPlatformAccessToken(request);
    const response = await requestProfileAvatarDelivery({
      ...(accessToken === undefined ? {} : { accessToken }),
      ...input,
      signal: request.signal,
    });
    return copyBackendResponse(response);
  } catch {
    return backendProxyProblem(
      503,
      "dependency_unavailable",
      "Avatar delivery is unavailable",
    );
  }
}
