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
import { PERSON_SEARCH_QUERY_MAX_CHARACTERS } from "../../domain/person-search-term.js";
import {
  PEOPLE_SEARCH_LIMIT,
  PeopleDirectory,
} from "../../facets/people-directory/people-directory.js";
import {
  peopleDirectoryProblem,
  personIdentityHttpSchema,
} from "../../shared/people-http.js";

const searchPeopleHttpSchema = z
  .object({
    items: z.array(personIdentityHttpSchema).max(PEOPLE_SEARCH_LIMIT),
    nameSearch: z.enum(["available", "unavailable"]),
  })
  .strict();

@ApiTags("People")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/people/search")
export class SearchPeopleController {
  constructor(
    @Inject(PeopleDirectory) private readonly directory: PeopleDirectory,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "searchPeople",
    summary:
      "Find people for the owner by Account ID, by exact email or by Telegram name and @username; Accounts without a Sign-in Email, verified Billing Contact or Telegram link are never found",
  })
  @ApiQuery({
    name: "query",
    required: true,
    description:
      "Trimmed, 1–160 characters. A UUID is an Account ID, an address is matched exactly, other text is a name or @username",
    schema: toOpenApiSchema(
      z.string().min(1).max(PERSON_SEARCH_QUERY_MAX_CHARACTERS),
    ),
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: toOpenApiSchema(z.int().min(1).max(PEOPLE_SEARCH_LIMIT)),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(searchPeopleHttpSchema) })
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
  async search(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("query") query: unknown,
    @Query("limit") limit: unknown,
  ): Promise<z.infer<typeof searchPeopleHttpSchema>> {
    const result = await this.directory.searchPeople(account.accountId, {
      query,
      ...(limit === undefined ? {} : { limit }),
    });
    if (!result.ok) throw peopleDirectoryProblem(result.error);
    return {
      items: result.value.items.map((person) => ({
        accountId: person.accountId,
        displayName: person.displayName,
        username: person.username,
        email: person.email,
        contactsState: person.contactsState,
      })),
      nameSearch: result.value.nameSearch,
    };
  }
}
