import { proxyProfileAvatarDelivery } from "@/_pages/member-profile.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly avatarId: string;
      readonly publicProfileId: string;
      readonly size: string;
    }>;
  },
): Promise<Response> {
  return proxyProfileAvatarDelivery(request, await context.params);
}
