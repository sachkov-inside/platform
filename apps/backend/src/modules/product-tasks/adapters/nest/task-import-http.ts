import { applyDecorators, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { problemDetailsContent } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
} from "../../../accounts/index.js";
import type { TaskImportError } from "../../features/import-product-task/import-product-task.contract.js";

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

/** The authentication, cache policy and tag of the Product Task import addresses. */
export function TaskImportEndpoint(): ClassDecorator {
  return applyDecorators(
    ApiTags("Product task authoring"),
    ApiBearerAuth("logto"),
    PrivateNoStore(),
    UseGuards(AccountGuard),
    UseFilters(AccountProblemDetailsFilter),
  );
}

export function ApiTaskImportErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        content: problemDetailsContent(taskImportProblemSchema),
      }),
    ),
  );
}

export function throwTaskImportError(error: TaskImportError): never {
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
