import "server-only";
import { z } from "zod";
import {
  requestCurrentCommunityAdmission,
  requestCancelBillingChange,
  requestCancelBillingRenewal,
  requestBillingChange,
  requestBillingChangeQuote,
  requestChangeBillingMethod,
  requestCurrentBilling,
  requestCurrentEnrollments,
  requestResumeBillingRenewal,
  requestRevokeBillingMethod,
} from "@/shared/api/backend/index.server";
import {
  cancelBillingChangeOperation,
  cancelBillingRenewalOperation,
  changeBillingOptionOperation,
  changeBillingPaymentMethodOperation,
  quoteBillingChangeOperation,
  resumeBillingRenewalOperation,
  revokeBillingPaymentMethodOperation,
} from "./billing-subscription.operation";

import {
  enrollmentsSchema,
  currentBillingSchema,
} from "@/entities/subscription";
import {
  readAuthenticatedBilling,
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { handleMutationOperation } from "@/shared/auth/index.server";


export function handleCurrentBilling(): Promise<Response> {
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentBilling(accessToken),
    currentBillingSchema,
  );
}

export function handleCancelRenewal(request: Request): Promise<Response> {
  return handleMutationOperation(request, cancelBillingRenewalOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(cancelBillingRenewalOperation, command, (input) =>
        requestCancelBillingRenewal(input, accessToken),
      ),
  });
}

export function handleResumeRenewal(request: Request): Promise<Response> {
  return handleMutationOperation(request, resumeBillingRenewalOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(resumeBillingRenewalOperation, command, (input) =>
        requestResumeBillingRenewal(input, accessToken),
      ),
  });
}

export function handleChangeQuote(request: Request): Promise<Response> {
  return handleMutationOperation(request, quoteBillingChangeOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(quoteBillingChangeOperation, command, (input) =>
        requestBillingChangeQuote(input, accessToken),
      ),
  });
}

export function handleChangeOption(request: Request): Promise<Response> {
  return handleMutationOperation(request, changeBillingOptionOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(changeBillingOptionOperation, command, (input) =>
        requestBillingChange(input, accessToken),
      ),
  });
}

export function handleCancelChange(request: Request): Promise<Response> {
  return handleMutationOperation(request, cancelBillingChangeOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(cancelBillingChangeOperation, command, (input) =>
        requestCancelBillingChange(input, accessToken),
      ),
  });
}

export function handleChangePaymentMethod(request: Request): Promise<Response> {
  return handleMutationOperation(request, changeBillingPaymentMethodOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        changeBillingPaymentMethodOperation,
        command,
        (input) => requestChangeBillingMethod(input, accessToken),
      ),
  });
}

export function handleRevokePaymentMethod(request: Request): Promise<Response> {
  return handleMutationOperation(request, revokeBillingPaymentMethodOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        revokeBillingPaymentMethodOperation,
        command,
        (input) => requestRevokeBillingMethod(input, accessToken),
      ),
  });
}

export function handleCurrentEnrollments(): Promise<Response> {
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentEnrollments(accessToken),
    enrollmentsSchema,
  );
}

export function handleCurrentCommunityAdmission(): Promise<Response> {
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentCommunityAdmission(accessToken),
    z.strictObject({
      admissionRestriction: z
        .enum(["none", "moderation", "external_unknown"])
        .nullable(),
      state: z.enum(["checking", "no_access", "moderation_blocked", "ready"]),
    }),
  );
}
