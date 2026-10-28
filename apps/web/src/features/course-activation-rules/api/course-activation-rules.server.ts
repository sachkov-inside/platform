import "server-only";

import { ownerBillingCommand } from "@/entities/subscription.server";

import { listCourseActivationRulesOperation } from "./list-course-activation-rules.operation";
import { saveCourseActivationRuleOperation } from "./save-course-activation-rule.operation";

export function handleListCourseActivationRules(
  request: Request,
): Promise<Response> {
  return ownerBillingCommand(
    request,
    listCourseActivationRulesOperation,
    (input) => ({ ...input, operation: "activationRules.list" }),
  );
}

export function handleSaveCourseActivationRule(
  request: Request,
): Promise<Response> {
  return ownerBillingCommand(
    request,
    saveCourseActivationRuleOperation,
    (input) => {
      const { expectedRevision, value: ruleValue, ...rest } = input;
      const { verificationMode, ...rule } = ruleValue;
      return {
        ...rest,
        value: {
          ...rule,
          ...(verificationMode === undefined ? {} : { verificationMode }),
        },
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        operation: "activationRules.save",
      };
    },
  );
}
