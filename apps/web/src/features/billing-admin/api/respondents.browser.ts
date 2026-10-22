import {
  importRespondentsOperation,
  issueRespondentLinkOperation,
  respondentsStatusOperation,
} from "./respondents.operation";

export const importRespondents = importRespondentsOperation.send;

export const issueRespondentLink = issueRespondentLinkOperation.send;

export const respondentsStatus = respondentsStatusOperation.send;
