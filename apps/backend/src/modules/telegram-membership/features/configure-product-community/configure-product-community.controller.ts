import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiResponse,
} from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  toOpenApiSchema,
  problemDetailsContent,
  problemDetailsSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  ApiAccountErrors,
  AccountProblemDetailsFilter,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { CommunityEntitlements } from "../../facets/community-entitlements/community-entitlements.js";
const configurationSchema = z.strictObject({
  productId: z.uuid(),
  groupRef: z.literal("primary").nullable(),
});

@ApiTags("Telegram community")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiAccountErrors(401, 500)
@ApiResponse({
  status: 400,
  content: problemDetailsContent(problemDetailsSchema(400, ["invalid_input"])),
})
@ApiResponse({
  status: 403,
  content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
})
@ApiResponse({
  status: 503,
  content: problemDetailsContent(
    problemDetailsSchema(503, ["dependency_unavailable"]),
  ),
})
@Controller("admin/products/:productId/community")
export class ConfigureProductCommunityController {
  constructor(
    @Inject(CommunityEntitlements)
    private readonly community: CommunityEntitlements,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "readProductCommunityConfiguration",
    summary: "Read the Product association with the existing Telegram group",
  })
  @ApiParam({ name: "productId", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(configurationSchema) })
  async read(
    @CurrentAccount() actor: AuthenticatedAccount,
    @Param("productId") productId: string,
  ) {
    const result = await this.community.readProductCommunityConfiguration(
      actor.accountId,
      productId,
    );
    if (!result.ok) fail(result.code);
    return result.value;
  }
  @Put()
  @HttpCode(200)
  @ApiOperation({
    operationId: "configureProductCommunity",
    summary: "Associate a Product with the existing Telegram group",
  })
  @ApiParam({ name: "productId", schema: { type: "string", format: "uuid" } })
  @ApiBody({
    schema: toOpenApiSchema(configurationSchema.omit({ productId: true })),
  })
  @ApiOkResponse({
    schema: toOpenApiSchema(z.strictObject({ ok: z.literal(true) })),
  })
  async save(
    @CurrentAccount() actor: AuthenticatedAccount,
    @Param("productId") productId: string,
    @Body() input: unknown,
  ) {
    const parsed = configurationSchema
      .omit({ productId: true })
      .safeParse(input);
    if (!parsed.success) fail("invalid_input");
    const result = await this.community.configureProductCommunity(
      actor.accountId,
      { productId, groupRef: parsed.data.groupRef },
    );
    if (!result.ok) fail(result.code);
    return result;
  }
}
function fail(
  code: "invalid_input" | "forbidden" | "dependency_unavailable",
): never {
  throw problemException(
    code === "invalid_input" ? 400 : code === "forbidden" ? 403 : 503,
    code,
    "Product community configuration failed",
  );
}
