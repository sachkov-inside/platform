import { proxyOwnProfileAvatarDelivery } from "@/_pages/account.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly avatarId: string;
      readonly size: string;
    }>;
  },
): Promise<Response> {
  return proxyOwnProfileAvatarDelivery(request, await context.params);
}
