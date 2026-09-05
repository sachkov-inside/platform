import {
  proxyContentCoverRemoval,
  proxyContentCoverUpload,
} from "@/features/content-covers.server";

interface CoverRouteContext {
  readonly params: Promise<{
    readonly ownerId: string;
    readonly ownerKind: string;
  }>;
}

export async function PUT(
  request: Request,
  context: CoverRouteContext,
): Promise<Response> {
  const { ownerId, ownerKind } = await context.params;
  return proxyContentCoverUpload(request, ownerKind, ownerId);
}

export async function DELETE(
  request: Request,
  context: CoverRouteContext,
): Promise<Response> {
  const { ownerId, ownerKind } = await context.params;
  return proxyContentCoverRemoval(request, ownerKind, ownerId);
}
