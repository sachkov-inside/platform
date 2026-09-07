import { Controller, Get, Inject, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { publishedCatalogItemHttpSchema } from "../../../content-library/index.js";
import { PersonalHome } from "../../facets/personal-home/personal-home.js";
import { throwPersonalHomeError } from "../../adapters/nest/personal-home-http.js";
const continueMaterialSchema = z.object({ material: publishedCatalogItemHttpSchema, lastOpenedAt: z.iso.datetime(), resume: z.discriminatedUnion("kind", [z.object({ kind: z.literal("start") }).strict(), z.object({ kind: z.literal("position"), positionSeconds: z.number().int().positive() }).strict(), z.object({ kind: z.literal("reached-end") }).strict()]) }).strict();
@ApiTags("Personal home")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("reading-activity/continue")
export class GetContinueMaterialsController {
  constructor(@Inject(PersonalHome) private readonly home: PersonalHome) {}
  @Get()
  @ApiOperation({ operationId: "getContinueMaterials", summary: "Read at most six accessible unfinished Materials of the current Account" })
  @ApiOkResponse({ schema: toOpenApiSchema(z.array(continueMaterialSchema).max(6)) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_request"])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["dependency_unavailable"])) })
  async read(@CurrentAccount() current: AuthenticatedAccount) {
    const result = await this.home.getContinue(current.accountId);
    if (!result.ok) throwPersonalHomeError(result.error.code);
    return result.value;
  }
}
