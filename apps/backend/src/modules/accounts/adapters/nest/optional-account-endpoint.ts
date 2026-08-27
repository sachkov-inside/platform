import { applyDecorators, UseFilters, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiResponse,
  ApiSecurity,
} from "@nestjs/swagger";

import { problemDetailsContent } from "../../../../infrastructure/http/zod-openapi.js";
import { accountProblemSchema } from "./account-http.contract.js";
import { AccountProblemDetailsFilter } from "./account-problem-details.filter.js";
import { OptionalAccountGuard } from "./account.guard.js";

export function OptionalAccountEndpoint(): ClassDecorator {
  return applyDecorators(
    ApiSecurity({}),
    ApiBearerAuth("logto"),
    ApiResponse({
      status: 401,
      description: "Optional Account proof is invalid",
      content: problemDetailsContent(accountProblemSchema),
    }),
    ApiResponse({
      status: 500,
      description: "Account resolution failed",
      content: problemDetailsContent(accountProblemSchema),
    }),
    ApiResponse({
      status: 503,
      description: "Account proof dependency is unavailable",
      content: problemDetailsContent(accountProblemSchema),
    }),
    UseGuards(OptionalAccountGuard),
    UseFilters(AccountProblemDetailsFilter),
  );
}
