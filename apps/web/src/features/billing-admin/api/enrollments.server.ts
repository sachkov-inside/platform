import "server-only";
import { readContentCatalogOperation } from "./enrollments.operation";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

export function handleReadContentCatalog(request: Request): Promise<Response> {
  return handleMutationOperation(request, readContentCatalogOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(readContentCatalogOperation, command, (input) =>
        requestManageBilling(
          { ...input, operation: "content.list" },
          accessToken,
        ),
      ),
  });
}
