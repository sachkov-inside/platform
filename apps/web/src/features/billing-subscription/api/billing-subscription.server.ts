import "server-only";

import {
  changeQuoteSchema,
  changeResultSchema,
  currentBillingSchema,
  subscriptionViewSchema,
} from "@/entities/subscription";
import {
  executeBillingCommand,
  readAuthenticatedBilling,
} from "@/entities/subscription.server";
import {
  requestCancelBillingChange,
  requestCancelBillingRenewal,
  requestBillingChange,
  requestBillingChangeQuote,
  requestChangeBillingMethod,
  requestCurrentBilling,
  requestResumeBillingRenewal,
  requestRevokeBillingMethod,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import {
  changeInputSchema,
  changeQuoteInputSchema,
  methodChangeValueSchema,
  resumeInputSchema,
  revisionCommandSchema,
  revokeMethodInputSchema,
} from "../model/subscription-commands";

export function handleCurrentBilling(): Promise<Response> {
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentBilling(accessToken),
    currentBillingSchema,
  );
}

export function handleCancelRenewal(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      revisionCommandSchema,
      subscriptionViewSchema,
      (input) => requestCancelBillingRenewal(input, accessToken),
    ),
  );
}

export function handleResumeRenewal(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      resumeInputSchema,
      subscriptionViewSchema,
      (input) => requestResumeBillingRenewal(input, accessToken),
    ),
  );
}

export function handleChangeQuote(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      changeQuoteInputSchema,
      changeQuoteSchema,
      (input) => requestBillingChangeQuote(input, accessToken),
    ),
  );
}

export function handleChangeOption(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(form, changeInputSchema, changeResultSchema, (input) =>
      requestBillingChange(input, accessToken),
    ),
  );
}

export function handleCancelChange(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      revisionCommandSchema,
      subscriptionViewSchema,
      (input) => requestCancelBillingChange(input, accessToken),
    ),
  );
}

export function handleChangePaymentMethod(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      revisionCommandSchema,
      methodChangeValueSchema,
      (input) => requestChangeBillingMethod(input, accessToken),
    ),
  );
}

export function handleRevokePaymentMethod(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      revokeMethodInputSchema,
      subscriptionViewSchema,
      (input) => requestRevokeBillingMethod(input, accessToken),
    ),
  );
}
