import "server-only";

import { SalesFunnelService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export function requestSalesFunnelReport(
  query: {
    readonly from: string;
    readonly to: string;
    readonly productId?: string;
    readonly chapterId?: string;
  },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new SalesFunnelService(request).readSalesFunnelReport({
        from: query.from,
        to: query.to,
        ...(query.productId === undefined
          ? {}
          : { productId: query.productId }),
        ...(query.chapterId === undefined
          ? {}
          : { chapterId: query.chapterId }),
      }),
    200,
    { accessToken },
  );
}
