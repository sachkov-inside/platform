import "server-only";
import {
  importRespondentsOperation,
  issueRespondentLinkOperation,
  respondentsStatusOperation,
} from "./respondents.operation";
import { ownerCommand } from "./billing-admin.server";

export function handleImportRespondents(request: Request): Promise<Response> {
  return ownerCommand(request, importRespondentsOperation, (input) => ({
    ...input,
    operation: "respondents.import",
  }));
}

export function handleIssueRespondentLink(request: Request): Promise<Response> {
  return ownerCommand(request, issueRespondentLinkOperation, (input) => ({
    ...input,
    operation: "respondents.issue",
  }));
}

export function handleRespondentsStatus(request: Request): Promise<Response> {
  return ownerCommand(request, respondentsStatusOperation, (input) => ({
    ...input,
    operation: "respondents.status",
  }));
}
