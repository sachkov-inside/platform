import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  createPaymentLinkInputSchema,
  listPaymentLinksInputSchema,
  paymentLinkOutcomeSchema,
  paymentLinksOutcomeSchema,
  revokePaymentLinkInputSchema,
} from "../model/payment-link-operations";

/** `paymentLinks.create`: личная ссылка на оплату продукта по согласованной цене. */
export const createOwnerPaymentLinkOperation = defineMutationOperation({
  input: createPaymentLinkInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-links/create",
  result: billingCommandResultSchema(paymentLinkOutcomeSchema),
  transportFailure: billingTransportFailure,
});

/** `paymentLinks.revoke` с ожидаемой редакцией ссылки. */
export const revokeOwnerPaymentLinkOperation = defineMutationOperation({
  input: revokePaymentLinkInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-links/revoke",
  result: billingCommandResultSchema(paymentLinkOutcomeSchema),
  transportFailure: billingTransportFailure,
});

/** `paymentLinks.list`: страница от новых к старым с фильтром продукта и состояния. */
export const listOwnerPaymentLinksOperation = defineMutationOperation({
  input: listPaymentLinksInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-links/list",
  result: billingCommandResultSchema(paymentLinksOutcomeSchema),
  transportFailure: billingTransportFailure,
});
