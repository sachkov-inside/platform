import { handleCreateContentCollection } from "@/_pages/content-collections.server";

export function POST(request: Request): Promise<Response> {
  return handleCreateContentCollection(request);
}
