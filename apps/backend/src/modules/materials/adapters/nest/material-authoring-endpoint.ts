import { applyDecorators, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter } from "../../../accounts/index.js";
import { materialAuthoringProblemSchema } from "./material-authoring-http.js";

export function MaterialAuthoringEndpoint(): ClassDecorator {
  return applyDecorators(
    ApiTags("Material authoring"),
    ApiBearerAuth("logto"),
    PrivateNoStore(),
    UseGuards(AccountGuard),
    UseFilters(AccountProblemDetailsFilter),
  );
}

export function ApiMaterialAuthoringErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        content: problemDetailsContent(materialAuthoringProblemSchema),
      }),
    ),
  );
}
