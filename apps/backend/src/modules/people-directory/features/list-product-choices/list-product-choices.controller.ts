import { Controller, Get, Inject, UseFilters, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  accountProblemSchema,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { PeopleDirectory } from "../../facets/people-directory/people-directory.js";
import { peopleDirectoryProblem } from "../../shared/people-http.js";
import { PRODUCT_CHOICES_LIMIT } from "./list-product-choices.js";

const productChoicesHttpSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.uuid(),
            name: z.string(),
            archived: z.boolean(),
          })
          .strict(),
      )
      .max(PRODUCT_CHOICES_LIMIT),
  })
  .strict();

@ApiTags("People")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/people/product-choices")
export class ListProductChoicesController {
  constructor(
    @Inject(PeopleDirectory) private readonly directory: PeopleDirectory,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listPeopleProductChoices",
    summary:
      "List every Product, archived ones flagged, sorted by name, for the people list filter and the grant dialog; requires billing:manage",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(productChoicesHttpSchema) })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async list(
    @CurrentAccount() account: AuthenticatedAccount,
  ): Promise<z.infer<typeof productChoicesHttpSchema>> {
    const result = await this.directory.listProductChoices(account.accountId);
    if (!result.ok) throw peopleDirectoryProblem(result.error);
    return {
      items: result.value.map((product) => ({
        productId: product.productId,
        name: product.name,
        archived: product.archived,
      })),
    };
  }
}
