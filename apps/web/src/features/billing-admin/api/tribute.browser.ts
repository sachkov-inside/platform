import type { z } from "zod";
import {
  billingCommandPayload,
  billingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  type tributeStatusInputSchema,
  tributeStatusOutcomeSchema,
} from "../model/tribute-operations";
export async function tributeStatus(
  input: z.infer<typeof tributeStatusInputSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/tribute/status",
      "POST",
      billingCommandPayload(input),
    ),
    tributeStatusOutcomeSchema,
  );
}
import {
  type saveTributePolicySchema,
  tributeSavePolicyOutcomeSchema,
} from "../model/tribute-operations";
export async function tributeSavePolicy(
  input: z.infer<typeof saveTributePolicySchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/tribute/save-policy",
      "POST",
      billingCommandPayload(input),
    ),
    tributeSavePolicyOutcomeSchema,
  );
}
import {
  type previewTributeImportSchema,
  tributePreviewOutcomeSchema,
} from "../model/tribute-operations";
export async function tributePreview(
  input: z.infer<typeof previewTributeImportSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/tribute/preview",
      "POST",
      billingCommandPayload(input),
    ),
    tributePreviewOutcomeSchema,
  );
}
import {
  type applyTributeImportSchema,
  tributeApplyOutcomeSchema,
} from "../model/tribute-operations";
export async function tributeApply(
  input: z.infer<typeof applyTributeImportSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/tribute/apply",
      "POST",
      billingCommandPayload(input),
    ),
    tributeApplyOutcomeSchema,
  );
}
import {
  type reconcileTributeSchema,
  tributeReconcileOutcomeSchema,
} from "../model/tribute-operations";
export async function tributeReconcile(
  input: z.infer<typeof reconcileTributeSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/tribute/reconcile",
      "POST",
      billingCommandPayload(input),
    ),
    tributeReconcileOutcomeSchema,
  );
}
import {
  type retryTributeInboxSchema,
  tributeRetryEventOutcomeSchema,
} from "../model/tribute-operations";
export async function tributeRetryEvent(
  input: z.infer<typeof retryTributeInboxSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/tribute/retry-event",
      "POST",
      billingCommandPayload(input),
    ),
    tributeRetryEventOutcomeSchema,
  );
}

import {
  type dismissTributeImportSchema,
  tributeDismissImportOutcomeSchema,
} from "../model/tribute-operations";
export async function tributeDismissImport(
  input: z.infer<typeof dismissTributeImportSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/tribute/dismiss-import",
      "POST",
      billingCommandPayload(input),
    ),
    tributeDismissImportOutcomeSchema,
  );
}
