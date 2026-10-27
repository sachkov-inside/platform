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
import { problemException } from "../../../../infrastructure/http/problem-details.js";
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
import type { AuthoringSearchKind } from "../../ports/authoring-search-group.js";
import {
  AUTHORING_SEARCH,
  AUTHORING_SEARCH_GROUP_LIMIT,
  AUTHORING_SEARCH_QUERY_MAX_CHARACTERS,
  type AuthoringSearch,
} from "./search-authoring.js";

const searchKinds = [
  "people",
  "products",
  "materials",
  "payments",
] as const satisfies readonly AuthoringSearchKind[];
/** Every group kind can answer «unavailable»: a kind missing above fails compilation here. */
const everyKindListed: [
  Exclude<AuthoringSearchKind, (typeof searchKinds)[number]>,
] extends [never]
  ? true
  : never = true;
void everyKindListed;

/** One variant per group kind: adding a group adds its variant here. */
const readyGroupHttpSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("people"),
      state: z.literal("ready"),
      items: z
        .array(
          z
            .object({
              accountId: z.uuid(),
              displayName: z.string().nullable(),
              username: z.string().nullable(),
              email: z.string().nullable(),
              contactsState: z.enum(["complete", "partial"]),
            })
            .strict(),
        )
        .max(AUTHORING_SEARCH_GROUP_LIMIT),
      partial: z
        .boolean()
        .describe("Name and @username search was unavailable"),
      truncated: z
        .boolean()
        .describe(
          "More people matched than the group shows; a more precise text finds the rest",
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("products"),
      state: z.literal("ready"),
      items: z
        .array(
          z
            .object({
              id: z.uuid(),
              name: z.string(),
              archived: z.boolean(),
            })
            .strict(),
        )
        .max(AUTHORING_SEARCH_GROUP_LIMIT),
    })
    .strict(),
  z
    .object({
      kind: z.literal("materials"),
      state: z.literal("ready"),
      items: z
        .array(
          z
            .object({
              id: z.uuid(),
              title: z.string().nullable(),
              publicationState: z.enum(["draft", "published", "unpublished"]),
              topic: z.string().nullable(),
            })
            .strict(),
        )
        .max(AUTHORING_SEARCH_GROUP_LIMIT),
    })
    .strict(),
  z
    .object({
      kind: z.literal("payments"),
      state: z.literal("ready"),
      items: z
        .array(
          z
            .object({
              purchaseRef: z.uuid(),
              productName: z.string(),
              amountKopecks: z.int().positive(),
              state: z.enum([
                "prepared",
                "sent",
                "unknown",
                "pending",
                "authorized",
                "confirmed",
                "failed",
              ]),
              createdAt: z.iso.datetime(),
            })
            .strict(),
        )
        .max(AUTHORING_SEARCH_GROUP_LIMIT),
      personSearch: z
        .enum(["available", "name_unavailable", "truncated", "unavailable"])
        .describe(
          "Whether payments were also searched by the person the text names: name_unavailable when names cannot be searched now, truncated when more people matched than the search takes and only the payments of some of them were searched, unavailable when the people directory did not answer; order number, bank payment number and amount are searched in every case",
        ),
    })
    .strict(),
]);

const authoringSearchHttpSchema = z
  .object({
    groups: z.array(
      z.discriminatedUnion("state", [
        readyGroupHttpSchema,
        z
          .object({
            kind: z.enum(searchKinds),
            state: z.literal("unavailable"),
          })
          .strict(),
      ]),
    ),
  })
  .strict();

@ApiTags("Authoring search")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/search")
export class SearchAuthoringController {
  constructor(
    @Inject(AUTHORING_SEARCH)
    private readonly authoringSearch: AuthoringSearch,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "searchAuthoring",
    summary:
      "Search the authoring groups the account may read, in a fixed order (people, products, materials, payments): at most five hits per group; a group whose dependency failed answers unavailable; an account that may read no group is refused",
  })
  @ApiQuery({
    name: "query",
    required: true,
    description:
      "Trimmed, 1–160 characters; whitespace runs count as one space",
    schema: toOpenApiSchema(
      z.string().min(1).max(AUTHORING_SEARCH_QUERY_MAX_CHARACTERS),
    ),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(authoringSearchHttpSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request_shape"]),
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
    content: problemDetailsContent(accountProblemSchema),
  })
  async search(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("query") query: unknown,
  ): Promise<z.infer<typeof authoringSearchHttpSchema>> {
    const result = await this.authoringSearch.search(account.accountId, query);
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "invalid_request_shape":
          throw problemException(
            400,
            error.code,
            "Authoring search query is malformed",
          );
        case "forbidden":
          throw problemException(
            403,
            error.code,
            "The account may read no authoring search group",
          );
      }
    }
    return {
      groups: result.value.groups.map((group) => {
        if (group.state === "unavailable")
          return { kind: group.kind, state: group.state };
        switch (group.kind) {
          case "people":
            return {
              kind: group.kind,
              state: group.state,
              items: group.items.map((person) => ({
                accountId: person.accountId,
                displayName: person.displayName,
                username: person.username,
                email: person.email,
                contactsState: person.contactsState,
              })),
              partial: group.partial,
              truncated: group.truncated,
            };
          case "products":
            return {
              kind: group.kind,
              state: group.state,
              items: group.items.map((product) => ({
                id: product.id,
                name: product.name,
                archived: product.archived,
              })),
            };
          case "materials":
            return {
              kind: group.kind,
              state: group.state,
              items: group.items.map((material) => ({
                id: material.id,
                title: material.title,
                publicationState: material.publicationState,
                topic: material.topic,
              })),
            };
          case "payments":
            return {
              kind: group.kind,
              state: group.state,
              items: group.items.map((payment) => ({
                purchaseRef: payment.purchaseRef,
                productName: payment.productName,
                amountKopecks: payment.amountKopecks,
                state: payment.state,
                createdAt: payment.createdAt,
              })),
              personSearch: group.personSearch,
            };
        }
      }),
    };
  }
}
