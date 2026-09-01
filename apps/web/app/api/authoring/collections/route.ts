import { handleContentCollectionMutation } from "@/_pages/content-collections.server";

export function PUT(request: Request): Promise<Response> {
  return handleContentCollectionMutation(request);
}
