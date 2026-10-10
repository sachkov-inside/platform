import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { z } from "zod";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import { throwTermMutationError } from "../../adapters/nest/term-authoring-http.js";
import {
  authoringTermSchema,
  authoringTermsSchema,
} from "./read-authoring-terms.contract.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/terms")
export class ReadAuthoringTermsController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listAuthoringTerms",
    summary:
      "List shared definitions for the author, including drafts, with mutation versions",
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    schema: toOpenApiSchema(z.uuid()),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(authoringTermsSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 500, 503)
  async list(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("cursor") cursor?: string,
  ) {
    const result = await this.authoring.listTerms({
      actor: account.accountId,
      cursor,
    });
    if (!result.ok) throwTermMutationError(result.error);
    return result.value;
  }

  @Get(":termId")
  @ApiOperation({
    operationId: "loadAuthoringTerm",
    summary:
      "Load a shared definition and its current mutation version for an author",
  })
  @ApiParam({ name: "termId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(authoringTermSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 500, 503)
  async load(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("termId") termId: string,
  ) {
    const result = await this.authoring.loadTerm({
      actor: account.accountId,
      termId,
    });
    if (!result.ok) {
      if (result.error.code === "term_not_found")
        throw problemException(404, result.error.code, "Term not found");
      throwTermMutationError(result.error);
    }
    return result.value;
  }
}
