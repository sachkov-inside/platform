// @ts-check
import { learningScenario } from "./learning.mjs";
import { scenarioRoles } from "./roles.mjs";

/** Owner commerce for the same synthetic Product that the learner reads. */
export const commerceScenario = {
  product: learningScenario.product,
  buyer: "learner",
  priceKopecks: 1_490_000,
  paymentState: "pending",
  checkoutButtonLabel: "Открыть тестовую оплату",
  waitlist: {
    intakeId: "97000000-0000-4000-8000-000000000301",
    name: "Учебный набор: следующий проект",
    accepting: true,
    source: "synthetic_learning",
  },
  telegram: {
    identityRef: "97000000-0000-4000-8000-000000000401",
    displayName: scenarioRoles.learner.name,
    username: "synthetic_learner",
    marketing: "stopped",
  },
};
