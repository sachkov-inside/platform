import { applyDecorators, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { AccountGuard } from "./account.guard.js";
import { AccountProblemDetailsFilter } from "./account-problem-details.filter.js";

export function AuthoringEndpoint(): ClassDecorator {
  return applyDecorators(
    ApiTags("Material authoring"),
    ApiBearerAuth("logto"),
    PrivateNoStore(),
    UseGuards(AccountGuard),
    UseFilters(AccountProblemDetailsFilter),
  );
}
