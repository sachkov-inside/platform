import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountEndpoint,
  ApiAccountErrors,
} from "../../adapters/nest/account-endpoint.js";
import { AccountGuard } from "../../adapters/nest/account.guard.js";
import { CurrentAccount } from "../../adapters/nest/current-account.js";
import type { AuthenticatedAccount } from "../../facets/accounts/accounts.interface.js";
import { BillingContact } from "../../facets/billing-contact/billing-contact.js";
import {
  acceptConsentsSchema,
  acceptConsentsResultSchema,
  confirmContactSchema,
  confirmContactResultSchema,
  readContactResultSchema,
  readConsentResultSchema,
  startContactSchema,
  startContactResultSchema,
  type ContactError,
} from "../../facets/billing-contact/billing-contact.contract.js";

const errorStatuses: Readonly<Record<ContactError["error"]["code"], number>> = {
  invalid_input: 400,
  forbidden: 403,
  revision_conflict: 409,
  operation_conflict: 409,
  rate_limited: 429,
  challenge_invalid: 400,
  contact_required: 409,
  document_changed: 409,
  not_found: 404,
  provider_unavailable: 503,
  internal_error: 500,
};
function response<Result extends { readonly ok: boolean }>(
  result: Result | ContactError,
): Result {
  if (!result.ok && "error" in result)
    throw new HttpException(
      { code: result.error.code },
      errorStatuses[result.error.code],
    );
  return result;
}

@Controller("accounts/current/billing")
@AccountEndpoint()
@UseGuards(AccountGuard)
export class BillingContactController {
  constructor(
    @Inject(BillingContact) private readonly billingContact: BillingContact,
  ) {}
  @Get("contact")
  @ApiOperation({
    operationId: "readBillingContact",
    summary: "Read own verified receipt contact and applicable documents",
  })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(readContactResultSchema),
  })
  @ApiAccountErrors(401, 403, 500, 503)
  async read(@CurrentAccount() account: AuthenticatedAccount) {
    return response(await this.billingContact.read(account.accountId));
  }

  @Post("contact/start")
  @HttpCode(200)
  @ApiOperation({
    operationId: "startBillingContact",
    summary: "Send an Account-bound email verification code",
  })
  @ApiBody({ schema: toOpenApiSchema(startContactSchema) })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(startContactResultSchema),
  })
  @ApiAccountErrors(400, 401, 403, 409, 429, 500, 503)
  async start(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() body: unknown,
  ) {
    return response(await this.billingContact.start(account.accountId, body));
  }

  @Post("contact/confirm")
  @HttpCode(200)
  @ApiOperation({
    operationId: "confirmBillingContact",
    summary: "Confirm the current email challenge without merging Accounts",
  })
  @ApiBody({ schema: toOpenApiSchema(confirmContactSchema) })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(confirmContactResultSchema),
  })
  @ApiAccountErrors(400, 401, 403, 409, 500, 503)
  async confirm(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() body: unknown,
  ) {
    return response(await this.billingContact.confirm(account.accountId, body));
  }

  @Get("consents/:evidenceRef")
  @ApiOperation({
    operationId: "readBillingConsent",
    summary: "Recover own immutable accepted edition",
  })
  @ApiParam({ name: "evidenceRef", schema: { type: "string", format: "uuid" } })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(readConsentResultSchema),
  })
  @ApiAccountErrors(401, 403, 404, 500)
  async readConsent(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("evidenceRef") evidenceRef: string,
  ) {
    return response(
      await this.billingContact.readConsent(account.accountId, evidenceRef),
    );
  }

  @Post("consents")
  @HttpCode(200)
  @ApiOperation({
    operationId: "acceptBillingConsents",
    summary: "Record explicit acceptance of exact applicable document versions",
  })
  @ApiBody({ schema: toOpenApiSchema(acceptConsentsSchema) })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(acceptConsentsResultSchema),
  })
  @ApiAccountErrors(400, 401, 403, 409, 500, 503)
  async accept(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() body: unknown,
  ) {
    return response(
      await this.billingContact.acceptConsents(account.accountId, body),
    );
  }
}
