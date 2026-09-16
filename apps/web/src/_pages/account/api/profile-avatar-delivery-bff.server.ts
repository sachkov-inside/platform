import "server-only";

import {
  backendProxyProblem,
  copyBackendResponse,
  requestOwnProfileAvatarDelivery,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

/**
 * The cabinet reads its own avatar. The Profile is seen only by its owner, so the image goes
 * through the owner's session and there is no address for another member or a guest.
 */
export async function proxyOwnProfileAvatarDelivery(
  request: Request,
  input: { readonly avatarId: string; readonly size: string },
): Promise<Response> {
  try {
    const accessToken = await getOptionalPlatformAccessToken(request);
    if (accessToken === undefined)
      return backendProxyProblem(401, "unauthorized", "Sign in to see your avatar");
    const response = await requestOwnProfileAvatarDelivery({
      accessToken,
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
