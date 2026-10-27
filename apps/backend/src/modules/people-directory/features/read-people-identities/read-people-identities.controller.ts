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
import {
  PEOPLE_IDENTITIES_LIMIT,
  PeopleDirectory,
} from "../../facets/people-directory/people-directory.js";
import {
  peopleDirectoryProblem,
  personIdentityHttpSchema,
} from "../../shared/people-http.js";

const peopleIdentitiesHttpSchema = z
  .object({
    items: z.array(personIdentityHttpSchema).max(PEOPLE_IDENTITIES_LIMIT),
  })
  .strict();

@ApiTags("People")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/people/identities")
export class ReadPeopleIdentitiesController {
  constructor(
    @Inject(PeopleDirectory) private readonly directory: PeopleDirectory,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "readPeopleIdentities",
    summary:
      "Read how the owner sees each of up to 100 known Accounts, in the requested order; an Account that is not a person is omitted",
  })
  @ApiQuery({
    name: "accountIds",
    required: true,
    description: "1–100 Account IDs separated by commas",
    schema: toOpenApiSchema(z.string().min(1)),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(peopleIdentitiesHttpSchema) })
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
  async read(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("accountIds") accountIds: unknown,
  ): Promise<z.infer<typeof peopleIdentitiesHttpSchema>> {
    const result = await this.directory.readIdentities(
      account.accountId,
      typeof accountIds === "string" ? accountIds.split(",") : accountIds,
    );
    if (!result.ok) throw peopleDirectoryProblem(result.error);
    return {
      items: result.value.map((person) => ({
        accountId: person.accountId,
        displayName: person.displayName,
        username: person.username,
        email: person.email,
        contactsState: person.contactsState,
      })),
    };
  }
}
