import { z } from "zod";

import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { problemDetailsSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  anonymousSubject,
  type Subject,
} from "../../../content-access/index.js";
import { taskCodeSchema } from "../../domain/task-definition.js";
import type { SystemError } from "../../shared/result.js";

/** The task code in a learner address; the same rule the import applies. */
export const taskCodeParamSchema = taskCodeSchema;

export const learnerTaskUnavailableProblemSchema = problemDetailsSchema(503, [
  "dependency_unavailable",
]);
export const learnerTaskFailureProblemSchema = problemDetailsSchema(500, [
  "internal_error",
]);

/** The Content Access subject of a learner request, anonymous without an Account proof. */
export function learnerSubject(
  account: AuthenticatedAccount | undefined,
): Subject {
  return account === undefined
    ? anonymousSubject
    : { kind: "account", accountId: accountId(account.accountId) };
}

/** The Problem Details of a dependency failure on a learner task request. */
export function throwSystemError(error: SystemError, title: string): never {
  if (error.code === "dependency_unavailable")
    throw problemException(
      503,
      error.code,
      `${title}: dependency unavailable`,
      {
        retryable: true,
      },
    );
  throw problemException(500, error.code, `${title} failed`, {
    correlationId: error.correlationId,
  });
}

export const criterionHttpSchema = z
  .object({
    id: z.string(),
    level: z.enum(["required", "additional"]),
    requirement: z.string(),
    acceptableEvidence: z.array(z.string()),
  })
  .strict();
