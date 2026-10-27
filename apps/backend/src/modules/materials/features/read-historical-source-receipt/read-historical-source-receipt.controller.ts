import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
} from "@nestjs/common";
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
} from "@nestjs/swagger";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  MaterialAuthoringEndpoint,
  ApiMaterialAuthoringErrors,
} from "../../adapters/nest/material-authoring-endpoint.js";
import {
  idempotencyKeySchema,
  materialMutationReceiptSchema,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import { historicalSourceMaterialRequestSchema } from "./read-historical-source-receipt.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/history/material-receipts")
export class ReadHistoricalSourceMaterialReceiptController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "readHistoricalSourceMaterialReceipt",
    summary:
      "Read an exact historical source request receipt without writing Material state",
  })
  @ApiBody({ schema: toOpenApiSchema(historicalSourceMaterialRequestSchema) })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeySchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(materialMutationReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 500, 503)
  async read(
    @CurrentAccount() actor: AuthenticatedAccount,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: unknown,
  ) {
    const parsed = historicalSourceMaterialRequestSchema.safeParse(input);
    if (!parsed.success)
      throw problemException(
        400,
        "invalid_request_shape",
        "Malformed historical source request",
      );
    const result = await this.authoring.readHistoricalSourceMaterialReceipt({
      ...parsed.data,
      actor: actor.accountId,
      idempotencyKey: key ?? "",
    });
    if (!result.ok) {
      const code = result.error.code;
      throw problemException(
        code === "forbidden"
          ? 403
          : code === "historical_receipt_not_found"
            ? 404
            : code === "idempotency_conflict" ||
                code === "historical_receipt_unavailable"
              ? 409
              : code === "dependency_unavailable"
                ? 503
                : 400,
        code,
        "Historical receipt is unavailable",
      );
    }
    return result.value;
  }
}
