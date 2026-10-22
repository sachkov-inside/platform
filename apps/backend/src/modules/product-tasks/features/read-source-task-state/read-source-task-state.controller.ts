import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery } from "@nestjs/swagger";

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
} from "../import-product-task/import-product-task.controller.js";
import {
  readSourceTaskStateQuerySchema,
  sourceTaskStateSchema,
} from "./read-source-task-state.contract.js";

@TaskImportEndpoint()
@Controller("authoring/import/tasks")
export class ReadSourceTaskStateController {
  constructor(
    @Inject(PRODUCT_TASK_IMPORT) private readonly tasks: ProductTaskImport,
  ) {}

  @Get("state")
  @ApiOperation({
    operationId: "readSourceTaskState",
    summary:
      "Read every source-owned Product Task of one source namespace with the commit of its current version",
  })
  @ApiQuery({
    name: "namespace",
    required: true,
    schema: toOpenApiSchema(readSourceTaskStateQuerySchema.shape.namespace),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(sourceTaskStateSchema) })
  @ApiTaskImportErrors(400, 401, 403, 500, 503)
  async read(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("namespace") namespace: unknown,
  ) {
    const query = readSourceTaskStateQuerySchema.safeParse({ namespace });
    if (!query.success) throwTaskImportError({ code: "invalid_request_shape" });
    const result = await this.tasks.readState(query.data, {
      actor: account.accountId,
    });
    if (!result.ok) throwTaskImportError(result.error);
    return result.value;
  }
}
