import {
  createParamDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { problemException } from "../../../../infrastructure/http/problem-details.js";
import type { AuthenticatedAccount } from "../../facets/accounts/accounts.interface.js";

export const currentAccountRequestProperty = Symbol("current-account");

type AuthenticatedRequest = FastifyRequest & {
  [currentAccountRequestProperty]?: AuthenticatedAccount;
};

export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAccount => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const account = request[currentAccountRequestProperty];
    if (account === undefined) {
      throw problemException(500, "missing_authenticated_account", "Authenticated Account is missing");
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
