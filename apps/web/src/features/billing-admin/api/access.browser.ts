import {
  listPeopleOperation,
  readAccessSummaryOperation,
} from "./access.operation";

export const listPeople = listPeopleOperation.send;

export const readAccessSummary = readAccessSummaryOperation.send;
