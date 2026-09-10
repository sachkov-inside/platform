import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import {
  bearerCredential,
  credentialsMatch,
} from "../../../../infrastructure/http/bearer-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  COMMUNITY_MAXIMUM_BODY_BYTES,
  DISPATCH_CONTRACT_VERSION,
  dispatchAuthorizeSchema,
  dispatchErrorSchema,
  dispatchResultSchema,
} from "../../domain/community-entitlement.js";
import { communityErrorStatus } from "../../infrastructure/http/community-protocol-status.js";
import { CommunityEntitlements } from "../../facets/community-entitlements/community-entitlements.js";
import {
  CommunityDispatchFilter,
  communityDispatchError,
} from "./community-dispatch-http.js";

const genericError = z.object({ code: z.enum(["malformed", "unauthorized"]) });
const correlation = z.looseObject({
  contractVersion: z.string(),
  operationId: z.uuid(),
});

@ApiTags("Telegram Community")
@ApiBearerAuth("telegram-community")
@PrivateNoStore()
@UseFilters(CommunityDispatchFilter)
@Controller("internal/billing-dispatch")
export class CommunityDispatchController {
  constructor(
    @Inject(CommunityEntitlements)
    private readonly community: CommunityEntitlements,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Post("authorize")
  @HttpCode(200)
  @ApiOperation({
    operationId: "authorizeCommunityDispatch",
    summary:
      "Authorize one correlated Telegram community attempt against the current right and link",
  })
  @ApiBody({ schema: toOpenApiSchema(dispatchAuthorizeSchema) })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(dispatchResultSchema) })
  @ApiResponse({ status: 400, schema: toOpenApiSchema(genericError) })
  @ApiResponse({ status: 401, schema: toOpenApiSchema(genericError) })
  @ApiResponse({ status: 409, schema: toOpenApiSchema(dispatchErrorSchema) })
  @ApiResponse({ status: 422, schema: toOpenApiSchema(dispatchErrorSchema) })
  @ApiResponse({ status: 503, schema: toOpenApiSchema(dispatchErrorSchema) })
  async authorize(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = this.config.communityEntitlements?.dispatchSecret;
    // Without its own credential this direction fails closed.
    if (
      secret === undefined ||
      !credentialsMatch(bearerCredential(authorization), secret)
    ) {
      throw new HttpException({ code: "unauthorized" }, 401);
    }
    const correlated = correlation.safeParse(body);
    const operationId = correlated.success
      ? correlated.data.operationId
      : undefined;
    if (
      correlated.success &&
      correlated.data.contractVersion !== DISPATCH_CONTRACT_VERSION
    ) {
      throw new HttpException(
        communityDispatchError(correlated.data.operationId, "unsupported_contract"),
        422,
      );
    }
    const parsed = dispatchAuthorizeSchema.safeParse(body);
    if (
      !parsed.success ||
      Buffer.byteLength(JSON.stringify(body)) > COMMUNITY_MAXIMUM_BODY_BYTES
    ) {
      // Without a parseable operationId there is no correlation to invent.
      throw new HttpException(
        operationId === undefined
          ? { code: "malformed" }
          : communityDispatchError(operationId, "malformed"),
        400,
      );
    }
    const outcome = await this.community.authorizeDispatch(parsed.data);
    if (outcome.ok) return outcome.result;
    throw new HttpException(
      outcome.error,
      communityErrorStatus[outcome.error.error],
    );
  }
}
