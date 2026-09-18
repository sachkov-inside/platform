import { connection } from "next/server";

import { proxyOwnProfileAvatarDelivery } from "@/_pages/account.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly avatarId: string;
      readonly size: string;
    }>;
  },
): Promise<Response> {
  await connection();
  return proxyOwnProfileAvatarDelivery(request, await context.params);
}
