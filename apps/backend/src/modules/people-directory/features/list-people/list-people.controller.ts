import {
  Controller,
  Get,
  Inject,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
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
import { productAccessOriginSchema } from "../../../account-rights/index.js";
import { PERSON_SEARCH_QUERY_MAX_CHARACTERS } from "../../domain/person-search-term.js";
import { PeopleDirectory } from "../../facets/people-directory/people-directory.js";
import {
  peopleDirectoryProblem,
  personIdentityHttpSchema,
} from "../../shared/people-http.js";
import {
  peopleTelegramFilterSchema,
  PEOPLE_CURSOR_MAX_CHARACTERS,
  PEOPLE_PAGE_DEFAULT_LIMIT,
  PEOPLE_PAGE_LIMIT,
} from "./list-people.js";

const peopleListHttpSchema = z
  .object({
    items: z
      .array(
        personIdentityHttpSchema
          .extend({
            telegram: z.enum(["linked", "not_linked"]),
            registeredAt: z.iso.datetime(),
            lastActivityAt: z.iso.datetime().nullable(),
            products: z.array(
              z
                .object({
                  productId: z.uuid(),
                  name: z.string(),
                  access: z.enum(["active", "revoked"]),
                  origin: productAccessOriginSchema,
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(PEOPLE_PAGE_LIMIT),
    total: z.int().min(0),
    nextCursor: z.string().max(PEOPLE_CURSOR_MAX_CHARACTERS).nullable(),
    nameSearch: z
      .enum(["available", "unavailable", "truncated"])
      .describe(
        "unavailable: the text was a name or @username and Telegram could not search it, so the empty list is no answer. truncated: more than 50 people matched the text; the items, the total and the cursor cover only the first 50 matches",
      ),
  })
  .strict();

@ApiTags("People")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/people")
export class ListPeopleController {
  constructor(
    @Inject(PeopleDirectory) private readonly directory: PeopleDirectory,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listPeople",
    summary:
      "List people for the owner, newest registration first: Accounts with a Sign-in Email, a verified Billing Contact or a current Telegram link, with their Products; search and filters narrow the list, the total counts every match, and the cursor keeps them",
  })
  @ApiQuery({
    name: "query",
    required: false,
    description:
      "Trimmed, 1–160 characters. A UUID is an Account ID, an address is matched exactly, other text is a Telegram name or @username",
    schema: toOpenApiSchema(
      z.string().min(1).max(PERSON_SEARCH_QUERY_MAX_CHARACTERS),
    ),
  })
  @ApiQuery({
    name: "productId",
    required: false,
    description: "Only people with a Product Access to this Product",
    schema: toOpenApiSchema(z.uuid()),
  })
  @ApiQuery({
    name: "origin",
    required: false,
    description:
      "Only people with a Product Access first acquired this way (of `productId` when given, otherwise of any Product)",
    schema: toOpenApiSchema(productAccessOriginSchema),
  })
  @ApiQuery({
    name: "state",
    required: false,
    description:
      "Only people with a Product Access in this state (of `productId` when given, otherwise of any Product)",
    schema: toOpenApiSchema(z.enum(["active", "revoked"])),
  })
  @ApiQuery({
    name: "telegram",
    required: false,
    description:
      "Only people with a Telegram problem the Overview counts: community_failed, the latest community operation was rejected, failed or is overdue; delivery_failed, a Telegram delivery's result is unknown or it failed in the last 30 days",
    schema: toOpenApiSchema(peopleTelegramFilterSchema),
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    description:
      "Opaque `nextCursor` of the previous page; valid only with the same query and filters",
    schema: toOpenApiSchema(
      z.string().min(1).max(PEOPLE_CURSOR_MAX_CHARACTERS),
    ),
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: `People per page, ${String(PEOPLE_PAGE_DEFAULT_LIMIT)} by default`,
    schema: toOpenApiSchema(z.int().min(1).max(PEOPLE_PAGE_LIMIT)),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(peopleListHttpSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
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
    @Query("query") query: unknown,
    @Query("productId") productId: unknown,
    @Query("origin") origin: unknown,
    @Query("state") state: unknown,
    @Query("telegram") telegram: unknown,
    @Query("cursor") cursor: unknown,
    @Query("limit") limit: unknown,
  ): Promise<z.infer<typeof peopleListHttpSchema>> {
    const given = {
      query,
      productId,
      origin,
      state,
      telegram,
      cursor,
      limit,
    };
    const result = await this.directory.listPeople(
      account.accountId,
      Object.fromEntries(
        Object.entries(given).filter(([, value]) => value !== undefined),
      ),
    );
    if (!result.ok) throw peopleDirectoryProblem(result.error);
    return {
      items: result.value.items.map((person) => ({
        accountId: person.accountId,
        displayName: person.displayName,
        username: person.username,
        email: person.email,
        contactsState: person.contactsState,
        telegram: person.telegram,
        registeredAt: person.registeredAt,
        lastActivityAt: person.lastActivityAt,
        products: person.products.map((product) => ({
          productId: product.productId,
          name: product.name,
          access: product.access,
          origin: product.origin,
        })),
      })),
      total: result.value.total,
      nextCursor: result.value.nextCursor,
      nameSearch: result.value.nameSearch,
    };
  }
}
