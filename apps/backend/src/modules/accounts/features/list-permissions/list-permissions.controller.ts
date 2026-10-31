import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountEndpoint,
  ApiAccountErrors,
} from "../../adapters/nest/account-endpoint.js";
import { permissionsResponseSchema } from "../../adapters/nest/account-http.contract.js";
import { throwAccountError } from "../../adapters/nest/account-http.js";
import { AccountGuard } from "../../adapters/nest/account.guard.js";
import { CurrentAccount } from "../../adapters/nest/current-account.js";
import { ACCOUNTS } from "../../accounts.tokens.js";
import type {
  Accounts,
  AuthenticatedAccount,
} from "../../facets/accounts/accounts.interface.js";

/** Web opens the admin only for an Account with at least one permission (#1879). */
@Controller("accounts/current/permissions")
@AccountEndpoint()
@UseGuards(AccountGuard)
export class ListPermissionsController {
  constructor(@Inject(ACCOUNTS) private readonly accounts: Accounts) {}

  @Get()
  @ApiOperation({
    operationId: "listCurrentAccountPermissions",
    summary:
      "List the effective permissions of the current Account; platform:admin lists every permission",
  })
  @ApiResponse({
    status: 200,
    schema: toOpenApiSchema(permissionsResponseSchema),
  })
  @ApiAccountErrors(400, 401, 500, 503)
  async list(@CurrentAccount() account: AuthenticatedAccount): Promise<object> {
    const result = await this.accounts.listPermissions({
      accountId: account.accountId,
    });
    if (!result.ok) throwAccountError(result.error);
    return { permissions: result.permissions };
  }
}
