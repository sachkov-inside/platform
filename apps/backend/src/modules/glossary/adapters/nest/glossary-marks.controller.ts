import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { glossaryTermIdSchema } from "@inside/material-blocks";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  GLOSSARY_MARKS_QUERY_MAX,
  glossaryTermMarkSchema,
  glossaryTermMarkValueSchema,
} from "../../domain/glossary-term-mark.js";
import {
  GLOSSARY,
  type Glossary,
  type GlossaryMarkError,
} from "../../facets/glossary/glossary.js";

const readMarksBodySchema = z
  .object({
    termIds: z.array(glossaryTermIdSchema).min(1).max(GLOSSARY_MARKS_QUERY_MAX),
  })
  .strict();
const setMarkBodySchema = z
  .object({ mark: glossaryTermMarkValueSchema })
  .strict();

/**
 * The reader's own «знаю» and «повторить» marks on the terms of a lesson deck «Термины урока».
 * A guest keeps no marks, so every route needs a signed-in Account.
 */
@ApiTags("Glossary")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({
  status: 400,
  content: problemDetailsOneOfContent(
    problemDetailsSchema(400, ["invalid_request"]),
    accountProblemSchema,
  ),
})
@ApiResponse({
  status: 401,
  content: problemDetailsContent(accountProblemSchema),
})
@ApiResponse({
  status: 500,
  content: problemDetailsContent(accountProblemSchema),
})
@ApiResponse({
  status: 503,
  content: problemDetailsOneOfContent(
    problemDetailsSchema(503, ["dependency_unavailable"]),
    accountProblemSchema,
  ),
})
@Controller("glossary/marks")
export class GlossaryMarksController {
  constructor(@Inject(GLOSSARY) private readonly glossary: Glossary) {}

  @Post("query")
  @HttpCode(200)
  @ApiOperation({
    operationId: "readGlossaryTermMarks",
    summary: "Read the current Account's marks on at most 100 Glossary Terms",
  })
  @ApiBody({ schema: toOpenApiSchema(readMarksBodySchema) })
  @ApiOkResponse({
    schema: toOpenApiSchema(
      z.object({ marks: z.array(glossaryTermMarkSchema) }).strict(),
    ),
  })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const parsed = readMarksBodySchema.safeParse(input);
    if (!parsed.success) throwMarkError({ code: "invalid_request" });
    const result = await this.glossary.readMarks({
      accountId: current.accountId,
      termIds: parsed.data.termIds,
    });
    if (!result.ok) throwMarkError(result.error);
    return { marks: result.value };
  }

  @Put(":termId")
  @HttpCode(200)
  @ApiOperation({
    operationId: "setGlossaryTermMark",
    summary:
      "Mark a Glossary Term «знаю» or «повторить» for the current Account",
  })
  @ApiParam({ name: "termId", schema: toOpenApiSchema(glossaryTermIdSchema) })
  @ApiBody({ schema: toOpenApiSchema(setMarkBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(glossaryTermMarkSchema) })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["term_not_found"]),
    ),
  })
  async set(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("termId") termId: string,
    @Body() input: unknown,
  ) {
    const parsed = setMarkBodySchema.safeParse(input);
    if (!parsed.success) throwMarkError({ code: "invalid_request" });
    const result = await this.glossary.setMark({
      accountId: current.accountId,
      termId,
      mark: parsed.data.mark,
    });
    if (!result.ok) throwMarkError(result.error);
    return result.value;
  }
}

function throwMarkError(error: GlossaryMarkError): never {
  switch (error.code) {
    case "invalid_request":
      throw problemException(400, error.code, "Glossary mark request failed");
    case "term_not_found":
      throw problemException(404, error.code, "Glossary Term not found");
    case "dependency_unavailable":
      throw problemException(503, error.code, "Dependency unavailable", {
        retryable: error.retryable,
      });
  }
}
