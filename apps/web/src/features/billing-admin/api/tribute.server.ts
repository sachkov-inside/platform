import "server-only";
import { executeBillingCommand } from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { tributeStatusInputSchema, tributeStatusOutcomeSchema } from "../model/tribute-operations";
export function handleTributeStatus(request: Request): Promise<Response> {
 return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, tributeStatusInputSchema, tributeStatusOutcomeSchema, input => { const { page, ...command } = input; return requestManageBilling({ ...command, ...(page === undefined ? {} : { page }), operation: "tribute.status" }, accessToken); }));
}
import { saveTributePolicySchema, tributeSavePolicyOutcomeSchema } from "../model/tribute-operations";
export function handleTributeSavePolicy(request: Request): Promise<Response> {
 return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, saveTributePolicySchema, tributeSavePolicyOutcomeSchema, input => { return requestManageBilling({ ...input, operation: "tribute.savePolicy" }, accessToken); }));
}
import { previewTributeImportSchema, tributePreviewOutcomeSchema } from "../model/tribute-operations";
export function handleTributePreview(request: Request): Promise<Response> {
 return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, previewTributeImportSchema, tributePreviewOutcomeSchema, input => { return requestManageBilling({ ...input, operation: "tribute.preview" }, accessToken); }));
}
import { applyTributeImportSchema, tributeApplyOutcomeSchema } from "../model/tribute-operations";
export function handleTributeApply(request: Request): Promise<Response> {
 return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, applyTributeImportSchema, tributeApplyOutcomeSchema, input => { return requestManageBilling({ ...input, operation: "tribute.apply" }, accessToken); }));
}
import { reconcileTributeSchema, tributeReconcileOutcomeSchema } from "../model/tribute-operations";
export function handleTributeReconcile(request: Request): Promise<Response> {
 return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, reconcileTributeSchema, tributeReconcileOutcomeSchema, input => { const { confirmedTerms, ...command } = input; return requestManageBilling({ ...command, ...(confirmedTerms === undefined ? {} : { confirmedTerms }), operation: "tribute.reconcile" }, accessToken); }));
}
import { retryTributeInboxSchema, tributeRetryEventOutcomeSchema } from "../model/tribute-operations";
export function handleTributeRetryEvent(request: Request): Promise<Response> {
 return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, retryTributeInboxSchema, tributeRetryEventOutcomeSchema, input => { const { action, ...command } = input; return requestManageBilling({ ...command, ...(action === undefined ? {} : { action }), operation: "tribute.retryEvent" }, accessToken); }));
}

import { dismissTributeImportSchema, tributeDismissImportOutcomeSchema } from "../model/tribute-operations";
export function handleTributeDismissImport(request: Request): Promise<Response> {
 return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, dismissTributeImportSchema, tributeDismissImportOutcomeSchema, input => requestManageBilling({ ...input, operation: "tribute.dismissImport" }, accessToken)));
}
