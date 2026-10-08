import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AssetDeliveryCache } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { learnerSubject } from "../../adapters/nest/learner-task-http.js";
import {
  TASK_ASSET_DELIVERY,
  type TaskAssetDelivery,
} from "./deliver-task-asset.js";

@ApiTags("Product task assets")
@OptionalAccountEndpoint()
@Controller("library/products")
export class DeliverTaskAssetController {
  constructor(
    @Inject(TASK_ASSET_DELIVERY) private readonly delivery: TaskAssetDelivery,
  ) {}
  @Get(":slug/tasks/:code/assets/:assetId")
  @AssetDeliveryCache()
  @ApiOperation({
    operationId: "deliverProductTaskAsset",
    summary: "Read a current Task asset through Task access",
  })
  @ApiParam({ name: "slug", schema: { type: "string" } })
  @ApiParam({ name: "code", schema: { type: "string" } })
  @ApiParam({ name: "assetId", schema: { type: "string", format: "uuid" } })
  @ApiFoundResponse({
    description: "Protected asset redirect",
    headers: { Location: { schema: { type: "string", format: "uri" } } },
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["asset_not_found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsContent(
      problemDetailsSchema(500, ["internal_error"]),
    ),
  })
  async deliver(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") productSlug: string,
    @Param("code") code: string,
    @Param("assetId") assetId: string,
  ) {
    const result = await this.delivery.deliver({
      subject: learnerSubject(account),
      productSlug,
      code,
      assetId,
    });
    if (!result.ok)
      throw problemException(
        result.error.code === "asset_not_found"
          ? 404
          : result.error.code === "dependency_unavailable"
            ? 503
            : 500,
        result.error.code,
        "Task asset unavailable",
      );
    return result.value;
  }
}
