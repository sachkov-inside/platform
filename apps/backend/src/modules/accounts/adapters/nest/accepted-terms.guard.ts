import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";
import { z } from "zod";

import { problemType } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
} from "../../../../infrastructure/http/zod-openapi.js";
import { ACCOUNTS, LOGTO_ACCESS_TOKEN_VERIFIER } from "../../accounts.tokens.js";
import type { Accounts } from "../../facets/accounts/accounts.interface.js";
import { LegalAcceptances } from "../../facets/legal-acceptances/legal-acceptances.js";
import type { LogtoAccessTokenVerifier } from "../../infrastructure/idp/logto/logto-access-token-verifier.js";
import { authenticateRequest, type AuthenticatedRequest } from "./account.guard.js";

const termsAcceptanceProblemSchema = z.object({
  type: z.literal(problemType("terms_acceptance_required")),
  title: z.string(),
  status: z.literal(403),
  detail: z.string(),
  code: z.literal("terms_acceptance_required"),
});

const termsAcceptanceUnavailableSchema = z.object({
  type: z.literal(problemType("internal_error")),
  title: z.string(),
  status: z.literal(500),
  detail: z.string(),
  code: z.literal("internal_error"),
});

const termsAcceptanceUnavailable = {
  type: problemType("internal_error"),
  title: "Terms acceptance could not be checked",
  status: 500,
  detail: "Terms acceptance could not be checked.",
  code: "internal_error",
} as const satisfies z.infer<typeof termsAcceptanceUnavailableSchema>;

const termsAcceptanceRequired = {
  type: problemType("terms_acceptance_required"),
  title: "Terms of use are not accepted",
  status: 403,
  detail: "Accept the terms of use in force on the first sign-in screen first.",
  code: "terms_acceptance_required",
} as const satisfies z.infer<typeof termsAcceptanceProblemSchema>;

/**
 * Authenticates the Account and lets it through only once the terms of use in force are accepted.
 * The cabinet, purchases and the Telegram link sit behind it, so neither the bot nor a direct API
 * call reaches them before the first sign-in screen.
 */
@Injectable()
export class AcceptedTermsGuard implements CanActivate {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
    @Inject(LegalAcceptances) private readonly acceptances: LegalAcceptances,
  ) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const account = await authenticateRequest(
      request,
      this.accounts,
      this.tokenVerifier,
    );
    const terms = await this.acceptances.checkTerms(account.accountId);
    if (!terms.ok) throw new HttpException(termsAcceptanceUnavailable, 500);
    if (!terms.accepted) throw new HttpException(termsAcceptanceRequired, 403);
    return true;
  }
}

/**
 * Guards a controller or route with `AcceptedTermsGuard` and declares its refusal. A controller that
 * already refuses with its own 403 passes that schema here: OpenAPI keeps one 403 per operation, so
 * both refusals are declared together instead of one silently replacing the other.
 */
export function AcceptedTermsEndpoint(...otherForbidden: readonly z.ZodType[]) {
  return applyDecorators(
    UseGuards(AcceptedTermsGuard),
    ApiResponse({
      status: 403,
      description: "The terms of use in force are not accepted yet",
      content:
        otherForbidden.length === 0
          ? problemDetailsContent(termsAcceptanceProblemSchema)
          : problemDetailsOneOfContent(termsAcceptanceProblemSchema, ...otherForbidden),
    }),
    ApiResponse({
      status: 500,
      description: "Terms acceptance could not be checked",
      content: problemDetailsContent(termsAcceptanceUnavailableSchema),
    }),
  );
}
