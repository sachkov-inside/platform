// @ts-check
import { learningScenario } from "./learning.mjs";
import { scenarioRoles } from "./roles.mjs";
import { paymentScenario } from "./payments.mjs";

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

/** Public test-only credential for the owned loopback provider. */
export const isolatedTelegramSecret =
  "synthetic-isolated-telegram-provider-secret";

/** Fixed identities and recorded terms for non-persistent previews; the seed resolves real IDs. */
export const commerceFixtureFacts = {
  operationRef: "97000000-0000-4000-8000-000000000501",
  buyerAccountId: "97000000-0000-4000-8000-000000000502",
  purchaseRef: "97000000-0000-4000-8000-000000000503",
  createdAt: learningScenario.fixtureDate,
  buyerEmail: `${scenarioRoles.learner.subject}@inside.test`,
  priceRevision: 1,
  supportMonths: 3,
  communityPolicy: "explicit",
  currency: paymentScenario.currency,
  timezone: paymentScenario.timezone,
  kind: "one_time",
  environment: "local",
  terminalRef: "INSIDELOCALDOUBLE",
  paymentId: "synthetic-pending-payment",
  fiscalization: "pending",
  access: "awaiting_payment",
  refundedKopecks: 0,
  refundableKopecks: 0,
};
