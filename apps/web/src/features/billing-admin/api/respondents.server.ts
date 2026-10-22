import "server-only";
import {
  importRespondentsOperation,
  issueRespondentLinkOperation,
  respondentsStatusOperation,
} from "./respondents.operation";
import {
  respondentImportOutcomeSchema,
  respondentLinkOutcomeSchema,
  respondentsOutcomeSchema,
} from "../model/respondent-operations";
import { ownerCommand } from "./billing-admin.server";

export function handleImportRespondents(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    importRespondentsOperation,
    respondentImportOutcomeSchema,
    (input) => ({ ...input, operation: "respondents.import" }),
  );
}

export function handleIssueRespondentLink(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    issueRespondentLinkOperation,
    respondentLinkOutcomeSchema,
    (input) => ({ ...input, operation: "respondents.issue" }),
  );
}

export function handleRespondentsStatus(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    respondentsStatusOperation,
    respondentsOutcomeSchema,
    (input) => ({ ...input, operation: "respondents.status" }),
  );
}
