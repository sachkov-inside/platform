import { expect, test } from "vitest";
import { activationRuleSchema } from "../../../src/modules/account-rights/domain/course-activation.js";

const rule = {
  id: "10000000-0000-4000-8000-000000000001",
  code: "course-v1",
  name: "Course",
  revision: 1,
  productId: "10000000-0000-4000-8000-000000000002",
  sourceRef: "source:separate-course-group",
  verificationMode: "course_membership",
  published: true,
  startsAt: "2030-01-01T00:00:00.000Z",
  endsAt: null,
};
test("course activation rule names its Product directly and rejects tariff selection", () => {
  expect(activationRuleSchema.safeParse(rule).success).toBe(true);
  expect(
    activationRuleSchema.safeParse({
      ...rule,
      tierId: rule.productId,
      tierRevision: 1,
    }).success,
  ).toBe(false);
});
