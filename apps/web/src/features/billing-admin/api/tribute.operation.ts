import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  applyTributeImportSchema,
  dismissTributeImportSchema,
  previewTributeImportSchema,
  reconcileTributeSchema,
  retryTributeInboxSchema,
  saveTributePolicySchema,
  tributeApplyOutcomeSchema,
  tributeDismissImportOutcomeSchema,
  tributePreviewOutcomeSchema,
  tributeReconcileOutcomeSchema,
  tributeRetryEventOutcomeSchema,
  tributeSavePolicyOutcomeSchema,
  tributeStatusInputSchema,
  tributeStatusOutcomeSchema,
} from "../model/tribute-operations";

export const tributeStatusOperation = defineMutationOperation({
  input: tributeStatusInputSchema,
  method: "POST",
  path: "/api/authoring/billing/tribute/status",
  result: billingCommandResultSchema(tributeStatusOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const tributeSavePolicyOperation = defineMutationOperation({
  input: saveTributePolicySchema,
  method: "POST",
  path: "/api/authoring/billing/tribute/save-policy",
  result: billingCommandResultSchema(tributeSavePolicyOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const tributePreviewOperation = defineMutationOperation({
  input: previewTributeImportSchema,
  method: "POST",
  path: "/api/authoring/billing/tribute/preview",
  result: billingCommandResultSchema(tributePreviewOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const tributeApplyOperation = defineMutationOperation({
  input: applyTributeImportSchema,
  method: "POST",
  path: "/api/authoring/billing/tribute/apply",
  result: billingCommandResultSchema(tributeApplyOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const tributeReconcileOperation = defineMutationOperation({
  input: reconcileTributeSchema,
  method: "POST",
  path: "/api/authoring/billing/tribute/reconcile",
  result: billingCommandResultSchema(tributeReconcileOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const tributeRetryEventOperation = defineMutationOperation({
  input: retryTributeInboxSchema,
  method: "POST",
  path: "/api/authoring/billing/tribute/retry-event",
  result: billingCommandResultSchema(tributeRetryEventOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const tributeDismissImportOperation = defineMutationOperation({
  input: dismissTributeImportSchema,
  method: "POST",
  path: "/api/authoring/billing/tribute/dismiss-import",
  result: billingCommandResultSchema(tributeDismissImportOutcomeSchema),
  transportFailure: billingTransportFailure,
});
