import { proxyContentCoverDelivery } from "@/features/content-covers.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly coverId: string;
      readonly width: string;
    }>;
  },
): Promise<Response> {
  const { coverId, width } = await context.params;
  return proxyContentCoverDelivery(request, coverId, width);
}
