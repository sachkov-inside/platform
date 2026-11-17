import { expect, test } from "vitest";
import {
  commerceHttpPayments,
  commerceHttpPeople,
} from "../../../../scenarios/commerce-http.mjs";
import {
  commerceIdentity,
  commercePayment,
  commercePeople,
} from "@/storybook/commerce.fixtures";
import {
  paymentsOutcomeSchema,
  paymentViewSchema,
  paymentsPageSchema,
} from "@/features/owner-payments/model/payment-contract";
import {
  peopleListResponseSchema,
  peopleListStateSchema,
} from "@/_pages/authoring-people/model/people-list";
import {
  commerceInterceptionPayments,
  commerceInterceptionPeople,
  commerceInterceptionWaitlist,
} from "../support/commerce-interception";

import { peopleIdentitiesResponseSchema } from "@/entities/authoring-person/model/people-reads";

test("independent commerce adapters satisfy the actual frontend contracts and preserve the unpaid learner", () => {
  expect(
    peopleIdentitiesResponseSchema.parse({ items: [commerceIdentity] }),
  ).toMatchObject({
    items: [
      {
        displayName: "Участник Тестов",
        email: null,
        contactsState: "complete",
      },
    ],
  });
  // PersonIdentity email is verified Billing Contact, not the private Sign-in Email.
  expect(
    JSON.stringify(peopleListResponseSchema.parse(commerceHttpPeople())),
  ).not.toContain("light-learner@inside.test");
  const backend = paymentsOutcomeSchema.parse(commerceHttpPayments());
  const story = paymentViewSchema.parse(commercePayment);
  const intercepted = paymentsPageSchema.parse(
    commerceInterceptionPayments().value,
  );
  for (const payment of [
    backend.result.items[0],
    story,
    intercepted.items[0],
  ]) {
    expect(payment).toMatchObject({
      amountKopecks: 1490000,
      state: "pending",
      kind: "one_time",
      environment: "local",
      access: "awaiting_payment",
      snapshot: {
        product: { name: "Учебный курс: от идеи к выпуску" },
        paymentOption: { mode: "one_time", months: 3, priceKopecks: 1490000 },
        supportMonths: 3,
        communityPolicy: "explicit",
      },
    });
  }
  for (const people of [
    peopleListResponseSchema.parse(commerceHttpPeople()),
    peopleListStateSchema.parse(commercePeople),
    commerceInterceptionPeople(),
  ]) {
    expect(people).toMatchObject({
      total: 1,
      nameSearch: "available",
      nextCursor: null,
      items: [
        {
          displayName: "Участник Тестов",
          username: "synthetic_learner",
          email: null,
          telegram: "linked",
          products: [],
        },
      ],
    });
  }
  expect(commerceInterceptionWaitlist()).toMatchObject({
    kind: "ready",
    active: true,
    continuation: false,
    name: "Учебный набор: следующий проект",
    intakeId: "97000000-0000-4000-8000-000000000301",
  });
});
