import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { ViewerAwareCatalogCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountId as checkedAccountId,
  accountProblemSchema,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { anonymousSubject } from "../../../content-access/index.js";
import {
  PUBLISHED_MATERIAL_READER,
  publishedMaterialProblemHttpSchema,
  type PublishedMaterialReader,
} from "../../../materials/index.js";
import { throwContentLibraryError } from "../../adapters/nest/content-library-http-errors.js";

const courseGlossaryHttpSchema = z
  .object({
    product: z.object({ slug: z.string(), name: z.string() }).strict(),
    terms: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          englishTitle: z.string().nullable(),
          shortDefinition: z.string(),
          fullDefinition: z.string(),
          lesson: z.object({ slug: z.string(), title: z.string() }).strict(),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * The course Glossary page «Словарь курса»: the terms the course lessons introduce, each with
 * its lesson. The answer depends on who reads it: a lesson the reader cannot open hides its terms.
 */
@ApiTags("Content library")
@ViewerAwareCatalogCache()
@OptionalAccountEndpoint()
@Controller("library")
export class ReadCourseGlossaryController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly reader: Pick<
      PublishedMaterialReader,
      "readCourseGlossary"
    >,
  ) {}

  @Get("products/:slug/glossary")
  @ApiOperation({
    operationId: "readCourseGlossary",
    summary: "Read the Glossary Terms introduced by a Product's lessons",
  })
  @ApiParam({
    name: "slug",
    required: true,
    schema: toOpenApiSchema(
      z
        .string()
        .max(120)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    ),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(courseGlossaryHttpSchema) })
  @ApiBadRequestResponse({
    description: "Product slug is malformed",
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiNotFoundResponse({
    description: "Product is not published",
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiInternalServerErrorResponse({
    description: "Glossary or Account resolution failed internally",
    content: problemDetailsOneOfContent(
      publishedMaterialProblemHttpSchema,
      accountProblemSchema,
    ),
  })
  @ApiServiceUnavailableResponse({
    description: "Glossary or Account dependency is unavailable",
    content: problemDetailsOneOfContent(
      publishedMaterialProblemHttpSchema,
      accountProblemSchema,
    ),
  })
  async read(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") slug: string,
  ) {
    const result = await this.reader.readCourseGlossary({
      productSlug: slug,
      subject:
        account === undefined
          ? anonymousSubject
          : { kind: "account", accountId: checkedAccountId(account.accountId) },
    });
    if (!result.ok) throwContentLibraryError(result.error);
    return result.value;
  }
}
