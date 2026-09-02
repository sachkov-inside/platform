import { handleTopicMaterialCatalogRequest } from "@/_pages/library.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly topicSlug: string }> },
): Promise<Response> {
  const { topicSlug } = await context.params;
  return handleTopicMaterialCatalogRequest(
    request,
    topicSlug,
    await getOptionalPlatformAccessToken(request),
  );
}
