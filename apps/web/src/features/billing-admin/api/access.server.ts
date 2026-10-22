import "server-only";
import {
  listPeopleOperation,
  readAccessSummaryOperation,
} from "./access.operation";
import { ownerCommand } from "./billing-admin.server";

export function handleListPeople(request: Request): Promise<Response> {
  return ownerCommand(request, listPeopleOperation, (input) => ({
    operation: "people.list",
    operationId: input.operationId,
    limit: input.limit,
    ...(input.offerId === undefined ? {} : { offerId: input.offerId }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.state === undefined ? {} : { state: input.state }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  }));
}

export function handleAccessSummary(request: Request): Promise<Response> {
  return ownerCommand(request, readAccessSummaryOperation, (input) => ({
    operation: "access.summary",
    operationId: input.operationId,
  }));
}
