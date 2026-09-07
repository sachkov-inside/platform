import { Body, Controller, HttpCode, Inject, Post, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { PersonalHome } from "../../facets/personal-home/personal-home.js";
import { throwPersonalHomeError } from "../../adapters/nest/personal-home-http.js";
import { recordMaterialOpenSchema } from "./record-material-open.js";
@ApiTags("Personal home")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("reading-activity/opens")
export class RecordMaterialOpenController {
  constructor(@Inject(PersonalHome) private readonly home: PersonalHome) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "recordMaterialOpen", summary: "Record a visible, successfully opened Material for the current Account" })
  @ApiBody({ schema: toOpenApiSchema(recordMaterialOpenSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(z.object({ openedAt: z.iso.datetime(), replayed: z.boolean() }).strict()) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_request"])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["access_denied"])) })
  @ApiResponse({ status: 409, content: problemDetailsContent(problemDetailsSchema(409, ["command_conflict", "access_changed"])) })
  @ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["dependency_unavailable"])) })
  async record(@CurrentAccount() current: AuthenticatedAccount, @Body() input: unknown) {
    const parsed = recordMaterialOpenSchema.safeParse(input);
    if (!parsed.success) throwPersonalHomeError("invalid_request");
    const result = await this.home.recordOpen({ ...parsed.data, accountId: current.accountId });
    if (!result.ok) throwPersonalHomeError(result.error.code);
    return result.value;
  }
}
