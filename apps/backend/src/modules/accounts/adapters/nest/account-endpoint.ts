import { applyDecorators, UseFilters } from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountProblemDetailsFilter } from "./account-problem-details.filter.js";
import { accountProblemSchema } from "./account-http.contract.js";

export function AccountEndpoint(): ClassDecorator {
  return applyDecorators(
    ApiTags("Accounts"),
    ApiBearerAuth("logto"),
    PrivateNoStore(),
    UseFilters(AccountProblemDetailsFilter),
  );
}

export function ApiAccountErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        content: problemDetailsContent(accountProblemSchema),
      }),
    ),
  );
}
