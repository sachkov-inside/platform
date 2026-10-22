import "server-only";
import { acceptBillingConsentsOperation } from "./billing-consents.operation";

import { requestBillingConsents } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { consentsValueSchema } from "../model/legal-documents";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "./billing-command.server";

export function handleBillingConsents(request: Request): Promise<Response> {
  return handleMutationOperation(request, acceptBillingConsentsOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(command, consentsValueSchema, (input) =>
        requestBillingConsents(
          {
            operationId: input.operationId,
            contextRef: input.contextRef,
            screen: input.screen,
            buttonLabel: input.buttonLabel,
            ...(input.shownTerms === undefined
              ? {}
              : { shownTerms: input.shownTerms }),
            documents: input.documents.map((document) => ({
              ...document,
              accepted: true,
            })),
          },
          accessToken,
        ),
      ),
  });
}
