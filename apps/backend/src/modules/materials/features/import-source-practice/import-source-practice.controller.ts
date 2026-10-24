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
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import { idempotencyKeySchema } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import {
  applySourcePracticeBodySchema,
  practiceImportReceiptSchema,
  type PracticeImportError,
} from "./import-source-practice.contract.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/history/practice-receipts")
export class ImportSourcePracticeController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "readHistoricalPracticeReceipt",
    summary:
      "Replay an authorized historical Practice receipt; new writes are retired",
  })
  @ApiBody({ schema: toOpenApiSchema(applySourcePracticeBodySchema) })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeySchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(practiceImportReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 409, 500, 503)
  async apply(
    @CurrentAccount() account: AuthenticatedAccount,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: unknown,
  ) {
    const parsed = applySourcePracticeBodySchema.safeParse(input);
    if (!parsed.success)
      throw problemException(
        400,
        "invalid_request_shape",
        "Practice import request is malformed",
      );
    const result = await this.authoring.readHistoricalPracticeReceipt({
      ...parsed.data,
      actor: account.accountId,
      idempotencyKey: key ?? "",
    });
    if (!result.ok) throwImportError(result.error);
    return result.value;
  }
}

function throwImportError(error: PracticeImportError): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw problemException(
        400,
        error.code,
        "Practice import request is malformed",
      );
    case "forbidden":
      throw problemException(
        403,
        error.code,
        "Practice authoring is forbidden",
      );
    case "practice_definition_retired":
      throw problemException(
        409,
        error.code,
        "Practice authoring is retired; import Product Tasks",
      );
    case "source_mismatch":
    case "practice_version_conflict":
    case "idempotency_conflict":
      throw problemException(
        409,
        error.code,
        "Practice import conflicts with current state",
      );
    case "dependency_unavailable":
      throw problemException(
        503,
        error.code,
        "Practice dependency is unavailable",
        { retryable: true },
      );
    case "internal_error":
      throw problemException(500, error.code, "Practice import failed", {
        correlationId: error.correlationId,
      });
  }
}
