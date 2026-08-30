import { BadRequestException, Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { z } from "zod";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { contentVersionSchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

const PAGE_SIZE = 20;
const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);
const pageSchema = z.coerce.number().int().min(1).max(10_000);
const searchSchema = z.string().trim().min(1).max(160);
const referenceSchema = z.object({ id: z.uuid(), name: z.string().min(1) }).strict();
const itemSchema = z
  .object({
    canDelete: z.boolean(),
    contentVersion: contentVersionSchema,
    format: referenceSchema.nullable(),
    materialId: z.uuid(),
    publicationState: publicationStateSchema,
    title: z.string().nullable(),
    topic: referenceSchema.nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const responseSchema = z
  .object({
    items: z.array(itemSchema),
    page: z.number().int().positive(),
    pageSize: z.literal(PAGE_SIZE),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class ListMaterialsController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listAuthoringMaterials",
    summary: "List the complete Material authoring corpus",
  })
  @ApiQuery({ name: "page", required: false, schema: toOpenApiSchema(pageSchema) })
  @ApiQuery({
    name: "publicationState",
    required: false,
    schema: toOpenApiSchema(publicationStateSchema),
  })
  @ApiQuery({ name: "search", required: false, schema: toOpenApiSchema(searchSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(responseSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 500, 503)
  async list(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("page") pageInput: string | undefined,
    @Query("publicationState") publicationStateInput: string | undefined,
    @Query("search") searchInput: string | undefined,
  ) {
    const parsed = z
      .object({
        page: pageSchema.default(1),
        publicationState: publicationStateSchema.optional(),
        search: searchSchema.optional(),
      })
      .strict()
      .safeParse({
        page: pageInput,
        publicationState: publicationStateInput,
        search: searchInput?.trim() === "" ? undefined : searchInput,
      });
    if (!parsed.success) {
      throw new BadRequestException({
        type: "urn:inside:problem:invalid-request-shape",
        title: "Material authoring query is malformed",
        status: 400,
        code: "invalid_request_shape",
      });
    }
    const result = await this.authoring.listMaterials({
      actor: account.accountId,
      first: PAGE_SIZE,
      page: parsed.data.page,
      ...(parsed.data.publicationState === undefined
        ? {}
        : { publicationState: parsed.data.publicationState }),
      ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
    });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return result.value;
  }
}
