import {
  tributeStatusOperation,
  tributeSavePolicyOperation,
  tributePreviewOperation,
  tributeApplyOperation,
  tributeReconcileOperation,
  tributeRetryEventOperation,
  tributeDismissImportOperation,
} from "./tribute.operation";
export const tributeStatus = tributeStatusOperation.send;
export const tributeSavePolicy = tributeSavePolicyOperation.send;
export const tributePreview = tributePreviewOperation.send;
export const tributeApply = tributeApplyOperation.send;
export const tributeReconcile = tributeReconcileOperation.send;
export const tributeRetryEvent = tributeRetryEventOperation.send;

export const tributeDismissImport = tributeDismissImportOperation.send;
