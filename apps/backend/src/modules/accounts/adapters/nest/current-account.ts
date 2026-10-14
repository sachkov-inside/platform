import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { problemException } from "../../../../infrastructure/http/problem-details.js";
import type { AuthenticatedAccount } from "../../facets/accounts/accounts.interface.js";

export const currentAccountRequestProperty = Symbol("current-account");

export const currentReceiptEmailProperty = Symbol("current-receipt-email");

type AuthenticatedRequest = FastifyRequest & {
  [currentAccountRequestProperty]?: AuthenticatedAccount;
  [currentReceiptEmailProperty]?: string;
};

export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAccount => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const account = request[currentAccountRequestProperty];
    if (account === undefined) {
      throw problemException(
        500,
        "missing_authenticated_account",
        "Authenticated Account is missing",
      );
    }
    return account;
  },
);

export const OptionalCurrentAccount = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): AuthenticatedAccount | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request[currentAccountRequestProperty];
  },
);

/** Receipt contact only; never an Account identity or authorization input. */
export const CurrentReceiptEmail = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>()[
      currentReceiptEmailProperty
    ],
);
