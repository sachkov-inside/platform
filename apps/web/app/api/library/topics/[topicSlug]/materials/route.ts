import { connection } from "next/server";

import { handleTopicMaterialCatalogRequest } from "@/features/library-catalog.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly topicSlug: string }> },
): Promise<Response> {
  await connection();
  const { topicSlug } = await context.params;
  return handleTopicMaterialCatalogRequest(
    request,
    topicSlug,
    await getOptionalPlatformAccessToken(request),
  );
}
