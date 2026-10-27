import "server-only";

import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { listCourseActivationRulesOperation } from "./list-course-activation-rules.operation";
import { saveCourseActivationRuleOperation } from "./save-course-activation-rule.operation";

export function handleListCourseActivationRules(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, listCourseActivationRulesOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        listCourseActivationRulesOperation,
        command,
        (input) =>
          requestManageBilling(
            { ...input, operation: "activationRules.list" },
            accessToken,
          ),
      ),
  });
}

export function handleSaveCourseActivationRule(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, saveCourseActivationRuleOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        saveCourseActivationRuleOperation,
        command,
        (input) => {
          const { expectedRevision, value: ruleValue, ...rest } = input;
          const { verificationMode, ...rule } = ruleValue;
          return requestManageBilling(
            {
              ...rest,
              value: {
                ...rule,
                ...(verificationMode === undefined ? {} : { verificationMode }),
              },
              ...(expectedRevision === undefined ? {} : { expectedRevision }),
              operation: "activationRules.save",
            },
            accessToken,
          );
        },
      ),
  });
}
