import "server-only";

import { requestBillingConsents } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import {
  consentsInputSchema,
  consentsValueSchema,
} from "../model/legal-documents";
import { executeBillingCommand } from "./billing-command.server";

export function handleBillingConsents(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeBillingCommand(
      form,
      consentsInputSchema,
      consentsValueSchema,
      (input) =>
        requestBillingConsents(
          {
            operationId: input.operationId,
            contextRef: input.contextRef,
            documents: input.documents.map((document) => ({
              ...document,
              accepted: true,
            })),
          },
          accessToken,
        ),
    ),
  );
}
