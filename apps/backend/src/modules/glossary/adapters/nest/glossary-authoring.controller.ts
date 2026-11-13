import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Inject,
  Put,
} from "@nestjs/common";
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { z } from "zod";

import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  ApiAccountErrors,
  AuthoringEndpoint,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { glossaryTermSchema } from "../../domain/glossary-term.js";
import {
  GLOSSARY,
  type Glossary,
  type GlossaryAuthoringError,
} from "../../facets/glossary/glossary.js";
import { replaceGlossaryBodySchema } from "../../features/replace-glossary/replace-glossary.js";

const glossaryProblemSchema = z
  .object({
    code: z.enum(["dependency_unavailable", "forbidden", "invalid_glossary"]),
    detail: z.string().optional(),
    retryable: z.boolean().optional(),
    status: z.number().int(),
    title: z.string(),
    type: z.string(),
  })
  .strict();

const glossaryListSchema = z
  .object({ terms: z.array(glossaryTermSchema) })
  .strict();

const glossaryReplacementSchema = z
  .object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  })
  .strict();

function ApiGlossaryErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        content: problemDetailsContent(glossaryProblemSchema),
        status,
      }),
    ),
  );
}

/**
 * The Glossary as authoring clients see it: the content package delivery reads it to compare and
 * replaces it whole (`glossary-v1`).
 */
@AuthoringEndpoint()
@Controller("authoring/glossary")
export class GlossaryAuthoringController {
  constructor(@Inject(GLOSSARY) private readonly glossary: Glossary) {}

  @Get()
  @ApiOperation({
    operationId: "listAuthoringGlossaryTerms",
    summary: "List every Glossary Term",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(glossaryListSchema) })
  @ApiAccountErrors(401, 500)
  @ApiGlossaryErrors(403, 503)
  async list(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.glossary.list({ actor: account.accountId });
    if (!result.ok) throwGlossaryError(result.error);
    return {
      terms: result.value.map((term) => ({
        id: term.id,
        title: term.title,
        englishTitle: term.englishTitle,
        shortDefinition: term.shortDefinition,
        fullDefinition: term.fullDefinition,
        introducedInSourceId: term.introducedInSourceId,
      })),
    };
  }

  @Put()
  @ApiOperation({
    operationId: "replaceAuthoringGlossary",
    summary:
      "Replace the whole Glossary; terms missing from the list are removed",
  })
  @ApiBody({ schema: toOpenApiSchema(replaceGlossaryBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(glossaryReplacementSchema) })
  @ApiAccountErrors(401, 500)
  @ApiGlossaryErrors(403, 422, 503)
  async replace(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = z.object({ terms: z.unknown() }).strict().safeParse(input);
    if (!body.success) {
      throw problemException(
        422,
        "invalid_glossary",
        "Glossary request is malformed",
      );
    }
    const result = await this.glossary.replace({
      actor: account.accountId,
      terms: body.data.terms,
    });
    if (!result.ok) throwGlossaryError(result.error);
    return {
      created: result.value.created,
      updated: result.value.updated,
      removed: result.value.removed,
      unchanged: result.value.unchanged,
    };
  }
}

function throwGlossaryError(error: GlossaryAuthoringError): never {
  switch (error.code) {
    case "forbidden":
      throw problemException(403, error.code, "Glossary change is forbidden");
    case "invalid_glossary":
      throw problemException(422, error.code, "Glossary is invalid", {
        detail: error.message,
      });
    case "dependency_unavailable":
      throw problemException(503, error.code, "Dependency unavailable", {
        retryable: error.retryable,
      });
  }
}
