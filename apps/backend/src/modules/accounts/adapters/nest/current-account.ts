import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

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
      throw new InternalServerErrorException({
        type: "urn:inside:problem:missing-authenticated-account",
        title: "Authenticated Account is missing",
        status: 500,
        code: "missing_authenticated_account",
      });
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
