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
import { z } from "zod";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  ApiTaskImportErrors,
  TaskImportEndpoint,
  throwTaskImportError,
} from "../../adapters/nest/task-import-http.js";
import {
  PRODUCT_TASK_IMPORT,
  type ProductTaskImport,
} from "../../facets/product-task-import/product-task-import.js";
import {
  applySourceTaskBodySchema,
  sourceTaskSchema,
  taskImportReceiptSchema,
  validateSourceTaskResultSchema,
} from "./import-product-task.contract.js";

const idempotencyKeyHeaderSchema = z.string().trim().min(1).max(200);

@TaskImportEndpoint()
@Controller("authoring/import/tasks")
export class ImportProductTaskController {
  constructor(
    @Inject(PRODUCT_TASK_IMPORT) private readonly tasks: ProductTaskImport,
  ) {}

  @Post("validate")
  @HttpCode(200)
  @ApiOperation({
    operationId: "validateSourceTask",
    summary:
      "Validate an authored Product Task and read its current revision without writes",
  })
  @ApiBody({ schema: toOpenApiSchema(sourceTaskSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(validateSourceTaskResultSchema) })
  @ApiTaskImportErrors(400, 401, 403, 409, 500, 503)
  async validate(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const result = await this.tasks.validate(input, {
      actor: account.accountId,
    });
    if (!result.ok) throwTaskImportError(result.error);
    return result.value;
  }

  @Post("apply")
  @HttpCode(200)
  @ApiOperation({
    operationId: "applySourceTask",
    summary:
      "Import a Product Task against its expected revision; a changed definition creates a new Task Version",
  })
  @ApiBody({ schema: toOpenApiSchema(applySourceTaskBodySchema) })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeyHeaderSchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(taskImportReceiptSchema) })
  @ApiTaskImportErrors(400, 401, 403, 404, 409, 500, 503)
  async apply(
    @CurrentAccount() account: AuthenticatedAccount,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: unknown,
  ) {
    const result = await this.tasks.apply(input, {
      actor: account.accountId,
      idempotencyKey: key ?? "",
    });
    if (!result.ok) throwTaskImportError(result.error);
    return result.value;
  }
}
