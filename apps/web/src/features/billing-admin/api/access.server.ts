import "server-only";
import {
  accessSummaryInputSchema,
  accessSummaryOutcomeSchema,
  listPeopleInputSchema,
  peopleOutcomeSchema,
} from "../model/access-operations";
import { ownerCommand } from "./billing-admin.server";

export function handleListPeople(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    listPeopleInputSchema,
    peopleOutcomeSchema,
    (input) => ({
      operation: "people.list",
      operationId: input.operationId,
      limit: input.limit,
      ...(input.offerId === undefined ? {} : { offerId: input.offerId }),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  );
}

export function handleAccessSummary(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    accessSummaryInputSchema,
    accessSummaryOutcomeSchema,
    (input) => ({
      operation: "access.summary",
      operationId: input.operationId,
    }),
  );
}
