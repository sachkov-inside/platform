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
  sourceTermSchema,
  applySourceTermBodySchema,
  saveTermBodySchema,
  termImportReceiptSchema,
  validateSourceTermResultSchema,
} from "./import-source-term.contract.js";
import { throwTermMutationError } from "../../adapters/nest/term-authoring-http.js";

@MaterialAuthoringEndpoint()
@Controller("authoring")
export class ImportSourceTermController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}

  @Post("import/terms/validate")
  @HttpCode(200)
  @ApiOperation({
    operationId: "validateSourceTerm",
    summary:
      "Validate authored term ownership and inspect its current mutation version without writes",
  })
  @ApiBody({ schema: toOpenApiSchema(sourceTermSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(validateSourceTermResultSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 409, 500, 503)
  async validate(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const parsed = sourceTermSchema.safeParse(input);
    if (!parsed.success)
      throw problemException(
        400,
        "invalid_request_shape",
        "Malformed term definition",
      );
    const result = await this.authoring.validateSourceTerm({
      ...parsed.data,
      actor: account.accountId,
    });
    if (!result.ok) throwTermMutationError(result.error);
    return result.value;
  }

  @Post("import/terms/apply")
  @HttpCode(200)
  @ApiOperation({
    operationId: "applySourceTerm",
    summary:
      "Import an authored shared definition against its explicit mutation version",
  })
  @ApiBody({ schema: toOpenApiSchema(applySourceTermBodySchema) })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeySchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(termImportReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 409, 500, 503)
  async apply(
    @CurrentAccount() account: AuthenticatedAccount,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: unknown,
  ) {
    const parsed = applySourceTermBodySchema.safeParse(input);
    if (!parsed.success)
      throw problemException(
        400,
        "invalid_request_shape",
        "Malformed term import",
      );
    const result = await this.authoring.applySourceTerm({
      ...parsed.data,
      actor: account.accountId,
      idempotencyKey: key ?? "",
    });
    if (!result.ok) throwTermMutationError(result.error);
    return result.value;
  }

  @Post("terms/save")
  @HttpCode(200)
  @ApiOperation({
    operationId: "saveTerm",
    summary:
      "Save a manual term definition against its explicit mutation version",
  })
  @ApiBody({ schema: toOpenApiSchema(saveTermBodySchema) })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeySchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(termImportReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 409, 500, 503)
  async save(
    @CurrentAccount() account: AuthenticatedAccount,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: unknown,
  ) {
    const parsed = saveTermBodySchema.safeParse(input);
    if (!parsed.success)
      throw problemException(
        400,
        "invalid_request_shape",
        "Malformed term save",
      );
    const result = await this.authoring.saveTerm({
      ...parsed.data,
      actor: account.accountId,
      idempotencyKey: key ?? "",
    });
    if (!result.ok) throwTermMutationError(result.error);
    return result.value;
  }
}
