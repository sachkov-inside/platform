import { Controller, Get, Inject, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { PersonalHome } from "../../facets/personal-home/personal-home.js";
import { throwPersonalHomeError } from "../../adapters/nest/personal-home-http.js";
import { continueMaterialSchema } from "../get-continue-materials/get-continue-materials.controller.js";
import { seriesContinuationHttpSchema } from "../get-series-continuation/get-series-continuation.controller.js";
export const learningHomeHttpSchema = z.object({ video: continueMaterialSchema.nullable(), series: seriesContinuationHttpSchema.nullable() }).strict();
@ApiTags("Personal home")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("reading-activity/learning-home")
export class GetLearningHomeController {
  constructor(@Inject(PersonalHome) private readonly home: PersonalHome) {}
  @Get()
  @ApiOperation({ operationId: "getLearningHome", summary: "Read the latest unfinished Series and partially watched Video of the current Account" })
  @ApiOkResponse({ schema: toOpenApiSchema(learningHomeHttpSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_request"])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["dependency_unavailable"])) })
  async read(@CurrentAccount() current: AuthenticatedAccount) {
    const result = await this.home.getLearning(current.accountId);
    if (!result.ok) throwPersonalHomeError(result.error.code);
    return result.value;
  }
}
