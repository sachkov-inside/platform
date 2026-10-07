import {
  applyDecorators,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
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
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  applySourceTaskBodySchema,
  sourceTaskSchema,
  taskImportReceiptSchema,
  validateSourceTaskResultSchema,
  type ApplySourceTaskOperation,
  type TaskImportError,
  type ValidateSourceTaskOperation,
} from "./import-product-task.contract.js";

export const PRODUCT_TASK_IMPORT = Symbol("PRODUCT_TASK_IMPORT");

export interface ProductTaskImport {
  readonly validate: ValidateSourceTaskOperation;
  readonly apply: ApplySourceTaskOperation;
}

const idempotencyKeyHeaderSchema = z.string().trim().min(1).max(200);
const taskImportProblemSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  correlationId: z.string().optional(),
  retryable: z.boolean().optional(),
  sourceIds: z.array(z.string()).optional(),
  sourceId: z.string().optional(),
});

function ApiTaskImportErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        content: problemDetailsContent(taskImportProblemSchema),
      }),
    ),
  );
}

@ApiTags("Product task authoring")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
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
    if (!result.ok) throwImportError(result.error);
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
    if (!result.ok) throwImportError(result.error);
    return result.value;
  }
}

function throwImportError(error: TaskImportError): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw problemException(
        400,
        error.code,
        "Product Task import is malformed",
      );
    case "forbidden":
      throw problemException(
        403,
        error.code,
        "Product Task import is forbidden",
      );
    case "product_not_found":
    case "chapter_not_found":
      throw problemException(
        404,
        error.code,
        "The Product or chapter of the task does not exist",
      );
    case "related_material_not_found":
      throw problemException(
        404,
        error.code,
        "A related Material does not exist",
        { sourceIds: [...error.sourceIds] },
      );
    case "after_material_not_in_chapter":
      throw problemException(
        404,
        error.code,
        "The Material the task follows is not in the task's chapter",
        { sourceId: error.sourceId },
      );
    case "source_mismatch":
    case "task_revision_conflict":
    case "idempotency_conflict":
      throw problemException(
        409,
        error.code,
        "Product Task import conflicts with the current task",
      );
    case "dependency_unavailable":
      throw problemException(
        503,
        error.code,
        "Product Task dependency is unavailable",
        { retryable: true },
      );
    case "internal_error":
      throw problemException(500, error.code, "Product Task import failed", {
        correlationId: error.correlationId,
      });
  }
}
