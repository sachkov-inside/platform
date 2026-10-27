import { handlePreviewProductRevocation } from "@/entities/subscription.server";
export function POST(request: Request): Promise<Response> {
  return handlePreviewProductRevocation(request);
}
