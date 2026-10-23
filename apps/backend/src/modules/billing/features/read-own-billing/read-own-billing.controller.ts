import { Controller, Get, Inject, UseFilters } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountProblemDetailsFilter,
  ApiAccountErrors,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  ACCESS_GRANTS,
  type AccessGrants,
} from "../../../account-rights/index.js";
import { BillingPayments } from "../../facets/billing-payments/billing-payments.js";
import { BillingNotices } from "../../facets/billing-notices/billing-notices.js";
import { throwPaymentError } from "../../shared/payment-http.filter.js";
import { readOwnBilling, ownBillingSchema } from "./read-own-billing.js";
@ApiTags("Billing")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseFilters(AccountProblemDetailsFilter)
@ApiAccountErrors(400, 401, 403, 500)
@Controller("accounts/current/billing")
export class ReadOwnBillingController {
  constructor(
    @Inject(BillingPayments) private readonly payments: BillingPayments,
    @Inject(BillingNotices) private readonly notices: BillingNotices,
    @Inject(ACCESS_GRANTS) private readonly grants: AccessGrants,
  ) {}
  @Get()
  @ApiOperation({
    operationId: "readOwnBilling",
    summary: "Read own lifetime Products, purchase history and service notices",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(ownBillingSchema) })
  async read(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await readOwnBilling(
      { payments: this.payments, notices: this.notices, grants: this.grants },
      account.accountId,
    );
    if (!result.ok) throwPaymentError(result.error.code);
    return result.value;
  }
}
