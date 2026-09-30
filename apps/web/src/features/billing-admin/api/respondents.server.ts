import "server-only";
import {
  importRespondentsInputSchema,
  issueRespondentLinkInputSchema,
  respondentImportOutcomeSchema,
  respondentLinkOutcomeSchema,
  respondentsOutcomeSchema,
  respondentsStatusInputSchema,
} from "../model/respondent-operations";
import { ownerCommand } from "./billing-admin.server";

export function handleImportRespondents(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    importRespondentsInputSchema,
    respondentImportOutcomeSchema,
    (input) => ({ ...input, operation: "respondents.import" }),
  );
}

export function handleIssueRespondentLink(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    issueRespondentLinkInputSchema,
    respondentLinkOutcomeSchema,
    (input) => ({ ...input, operation: "respondents.issue" }),
  );
}

export function handleRespondentsStatus(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    respondentsStatusInputSchema,
    respondentsOutcomeSchema,
    (input) => ({ ...input, operation: "respondents.status" }),
  );
}
