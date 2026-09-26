import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountEndpoint,
  ApiAccountErrors,
} from "../../adapters/nest/account-endpoint.js";
import { AccountGuard } from "../../adapters/nest/account.guard.js";
import { CurrentAccount } from "../../adapters/nest/current-account.js";
import type { AuthenticatedAccount } from "../../facets/accounts/accounts.interface.js";
import { LegalAcceptances } from "../../facets/legal-acceptances/legal-acceptances.js";
import {
  acceptTermsResultSchema,
  acceptTermsSchema,
  listAcceptedDocumentsResultSchema,
  readTermsStatusResultSchema,
  type LegalAcceptanceError,
} from "../../facets/legal-acceptances/legal-acceptances.contract.js";

const errorStatuses: Readonly<
  Record<LegalAcceptanceError["error"]["code"], number>
> = {
  invalid_input: 400,
  forbidden: 403,
  document_changed: 409,
  operation_conflict: 409,
  internal_error: 500,
};

function response<Result extends { readonly ok: boolean }>(
  result: Result | LegalAcceptanceError,
): Result {
  if (!result.ok && "error" in result)
    throw new HttpException(
      { code: result.error.code },
      errorStatuses[result.error.code],
    );
  return result;
}

/**
 * The first sign-in screen and the cabinet block «Принятые документы». Reachable before the terms
 * are accepted: this is where they get accepted.
 */
@Controller("accounts/current/legal-acceptances")
@AccountEndpoint()
@UseGuards(AccountGuard)
export class LegalAcceptancesController {
  constructor(
    @Inject(LegalAcceptances) private readonly acceptances: LegalAcceptances,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listLegalAcceptances",
    summary: "List own accepted legal documents, newest first",
  })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(listAcceptedDocumentsResultSchema),
  })
  @ApiAccountErrors(401, 403, 500, 503)
  async list(@CurrentAccount() account: AuthenticatedAccount) {
    return response(await this.acceptances.listAccepted(account.accountId));
  }

  @Get("terms")
  @ApiOperation({
    operationId: "readTermsAcceptance",
    summary: "Read whether the terms of use in force are accepted",
  })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(readTermsStatusResultSchema),
  })
  @ApiAccountErrors(401, 403, 500, 503)
  async readTerms(@CurrentAccount() account: AuthenticatedAccount) {
    return response(await this.acceptances.readTermsStatus(account.accountId));
  }

  @Post("terms")
  @HttpCode(200)
  @ApiOperation({
    operationId: "acceptTerms",
    summary:
      "Accept the exact terms of use edition in force by the pressed button",
  })
  @ApiBody({ schema: toOpenApiSchema(acceptTermsSchema) })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(acceptTermsResultSchema),
  })
  @ApiAccountErrors(400, 401, 403, 409, 500, 503)
  async acceptTerms(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() body: unknown,
  ) {
    return response(
      await this.acceptances.acceptTerms(account.accountId, body),
    );
  }
}
