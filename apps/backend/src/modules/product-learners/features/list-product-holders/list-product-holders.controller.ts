import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  ACCOUNTS,
  AccountGuard,
  AccountProblemDetailsFilter,
  ApiAccountErrors,
  CurrentAccount,
  accountProblemSchema,
  type Accounts,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  ACCESS_GRANTS,
  type AccessGrants,
} from "../../../account-rights/index.js";
import { ReadingActivity } from "../../../reading-activity/index.js";
import {
  listProductHolders,
  productHoldersPageSchema,
  productHoldersQuerySchema,
} from "./list-product-holders.js";

/** Query strings carry text; a repeated `accountIds` arrives as a list, a single one as text. */
const transportQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/)
    .transform(Number)
    .optional(),
  access: z.enum(["active", "revoked"]).optional(),
  accountIds: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
});

@ApiTags("Access")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiAccountErrors(401, 500)
@Controller("admin/products/:productId/holders")
export class ListProductHoldersController {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(ACCESS_GRANTS) private readonly grants: AccessGrants,
    @Inject(ReadingActivity) private readonly reading: ReadingActivity,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listProductHolders",
    summary:
      "Read one Product's holders newest first with their learning progress, without names or emails",
  })
  @ApiParam({
    name: "productId",
    schema: toOpenApiSchema(productHoldersQuerySchema.shape.productId),
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    schema: toOpenApiSchema(productHoldersQuerySchema.shape.cursor.unwrap()),
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: toOpenApiSchema(productHoldersQuerySchema.shape.limit.unwrap()),
  })
  @ApiQuery({
    name: "access",
    required: false,
    schema: toOpenApiSchema(productHoldersQuerySchema.shape.access.unwrap()),
  })
  @ApiQuery({
    name: "accountIds",
    required: false,
    description:
      "Only these Accounts (repeat the parameter, at most 50); an Account without access is absent",
    schema: toOpenApiSchema(
      productHoldersQuerySchema.shape.accountIds.unwrap(),
    ),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(productHoldersPageSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["product_not_found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async list(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("productId") productId: string,
    @Query() input: unknown,
  ) {
    const transport = transportQuerySchema.safeParse(input);
    const result = await listProductHolders(
      { accounts: this.accounts, grants: this.grants, reading: this.reading },
      current.accountId,
      transport.success ? holdersQuery(productId, transport.data) : null,
    );
    if (result.ok) return result.value;
    switch (result.error.code) {
      case "invalid_request":
        throw problemException(
          400,
          "invalid_request",
          "Invalid holders request",
        );
      case "forbidden":
        throw problemException(
          403,
          "forbidden",
          "Product holders permission required",
        );
      case "product_not_found":
        throw problemException(404, "product_not_found", "Product not found");
      case "dependency_unavailable":
        throw problemException(
          503,
          "dependency_unavailable",
          "Product holders are unavailable",
        );
    }
  }
}

function holdersQuery(
  productId: string,
  transport: z.output<typeof transportQuerySchema>,
) {
  const { cursor, limit, access, accountIds } = transport;
  return {
    productId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
    ...(access === undefined ? {} : { access }),
    ...(accountIds === undefined ? {} : { accountIds }),
  };
}
