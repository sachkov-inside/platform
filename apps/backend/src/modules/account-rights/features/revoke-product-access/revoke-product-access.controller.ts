import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  ApiAccountErrors,
  AccountProblemDetailsFilter,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { ACCESS_GRANTS } from "../../account-rights.tokens.js";
import type { AccessGrants } from "../../facets/access-grants/assemble-access-grants.js";
import {
  productRevocationCommandSchema,
  productRevocationPreviewSchema,
  productRevocationResultSchema,
  productRevocationTargetSchema,
} from "./revoke-product-access.js";

@ApiTags("Access")
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
  status: 404,
  content: problemDetailsContent(problemDetailsSchema(404, ["not_found"])),
})
@ApiResponse({
  status: 403,
  content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
})
@ApiResponse({
  status: 409,
  content: problemDetailsContent(
    problemDetailsSchema(409, ["revision_conflict", "operation_conflict"]),
  ),
})
@ApiResponse({
  status: 503,
  content: problemDetailsContent(problemDetailsSchema(503, ["unavailable"])),
})
@Controller("admin/access/products")
export class RevokeProductAccessController {
  constructor(@Inject(ACCESS_GRANTS) private readonly grants: AccessGrants) {}

  @Post("preview-revoke")
  @HttpCode(200)
  @ApiOperation({
    operationId: "previewProductAccessRevocation",
    summary: "Preview all current grounds affected by one Product revocation",
  })
  @ApiBody({ schema: toOpenApiSchema(productRevocationTargetSchema) })
  @ApiOkResponse({
    schema: toOpenApiSchema(
      z.strictObject({
        ok: z.literal(true),
        value: productRevocationPreviewSchema,
      }),
    ),
  })
  async preview(
    @CurrentAccount() actor: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const result = await this.grants.previewProductRevocation(
      actor.accountId,
      input,
    );
    if (!result.ok) fail(result.error.code);
    return result;
  }

  @Post("revoke")
  @HttpCode(200)
  @ApiOperation({
    operationId: "revokeProductAccess",
    summary: "Revoke a selected Product across its existing access grounds",
  })
  @ApiBody({ schema: toOpenApiSchema(productRevocationCommandSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productRevocationResultSchema) })
  async revoke(
    @CurrentAccount() actor: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const result = await this.grants.revokeProductAccess(
      actor.accountId,
      input,
    );
    if (!result.ok) fail(result.error.code);
    return result;
  }
}
function fail(
  code:
    | "not_found"
    | "invalid_input"
    | "operation_conflict"
    | "revision_conflict"
    | "forbidden"
    | "unavailable",
): never {
  const status =
    code === "not_found"
      ? 404
      : code === "forbidden"
        ? 403
        : code === "invalid_input"
          ? 400
          : code === "unavailable"
            ? 503
            : 409;
  throw problemException(status, code, "Product access operation failed");
}
