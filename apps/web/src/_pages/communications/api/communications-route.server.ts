import "server-only";

import { z } from "zod";

import {
  requestCommunications,
  requestCommunicationsTemplate,
} from "@/shared/api/backend/communications.server";

import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  deliveryListSchema,
  funnelListSchema,
  funnelSchema,
  introSchema,
  previewSchema,
  templateSchema,
} from "../model/communications";

import {
  changeFunnelLifecycleOperation,
  listFunnelsOperation,
  previewFunnelOperation,
  publishFunnelOperation,
  readDeliveriesOperation,
  readFunnelOperation,
  readIntroOperation,
  resolveTemplateOperation,
  retryDeliveryOperation,
  saveFunnelOperation,
  saveIntroOperation,
  skipDeliveryOperation,
} from "./communications.operation";
import { executeCommunications } from "./response.server";

const invalidInput = () => ({ kind: "error", code: "invalid" }) as const;

export function handleListFunnels(request: Request): Promise<Response> {
  return handleMutationOperation(request, listFunnelsOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(funnelListSchema, undefined, () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "funnels.list",
            operationId: crypto.randomUUID(),
            expectedRevision: 0,
            payload: {
              ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            },
          },
          token,
        ),
      ),
  });
}

export function handleReadFunnel(request: Request): Promise<Response> {
  return handleMutationOperation(request, readFunnelOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(funnelSchema, "funnel", () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "funnels.read",
            operationId: crypto.randomUUID(),
            expectedRevision: 0,
            payload: { funnelId: input.funnelId },
          },
          token,
        ),
      ),
  });
}

export function handleSaveFunnel(request: Request): Promise<Response> {
  return handleMutationOperation(request, saveFunnelOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(funnelSchema, "funnel", () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "funnels.save",
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            payload: input.draft,
          },
          token,
        ),
      ),
  });
}

export function handlePreviewFunnel(request: Request): Promise<Response> {
  return handleMutationOperation(request, previewFunnelOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(previewSchema, "preview", () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "funnels.preview",
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            payload: { funnelId: input.funnelId },
          },
          token,
        ),
      ),
  });
}

export function handlePublishFunnel(request: Request): Promise<Response> {
  return handleMutationOperation(request, publishFunnelOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(funnelSchema, "funnel", () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "funnels.publish",
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            payload: { funnelId: input.funnelId },
          },
          token,
        ),
      ),
  });
}

export function handleChangeFunnelLifecycle(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, changeFunnelLifecycleOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(funnelSchema, "funnel", () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "funnels.lifecycle",
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            payload: { funnelId: input.funnelId, action: input.action },
          },
          token,
        ),
      ),
  });
}

export function handleReadIntro(request: Request): Promise<Response> {
  return handleMutationOperation(request, readIntroOperation, {
    invalidInput,
    execute: (_input, token) =>
      executeCommunications(introSchema, "intro", () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "intro.read",
            operationId: crypto.randomUUID(),
            expectedRevision: 0,
            payload: {},
          },
          token,
        ),
      ),
  });
}

export function handleSaveIntro(request: Request): Promise<Response> {
  return handleMutationOperation(request, saveIntroOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(introSchema, "intro", () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "intro.save",
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            payload: { introId: input.introId, parts: input.parts },
          },
          token,
        ),
      ),
  });
}

export function handleReadDeliveries(request: Request): Promise<Response> {
  return handleMutationOperation(request, readDeliveriesOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(deliveryListSchema, undefined, () =>
        requestCommunications(
          {
            contractVersion: "inside-communications-v1",
            operation: "deliveries.read",
            operationId: crypto.randomUUID(),
            expectedRevision: 0,
            payload: {
              funnelId: input.funnelId,
              ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            },
          },
          token,
        ),
      ),
  });
}

export function handleSkipDelivery(request: Request): Promise<Response> {
  return handleMutationOperation(request, skipDeliveryOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(
        z.object({
          deliveryId: z.guid(),
          partId: z.guid(),
          outcome: z.literal("skipped"),
        }),
        undefined,
        () =>
          requestCommunications(
            {
              contractVersion: "inside-communications-v1",
              operation: "delivery.resolve",
              operationId: input.operationId,
              expectedRevision: input.expectedRevision,
              payload: {
                deliveryId: input.deliveryId,
                partId: input.partId,
                duplicateRiskAccepted: false,
                action: "skip",
              },
            },
            token,
          ),
      ),
  });
}

export function handleRetryDelivery(request: Request): Promise<Response> {
  return handleMutationOperation(request, retryDeliveryOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(
        z.object({
          deliveryId: z.guid(),
          partId: z.guid(),
          outcome: z.literal("retry_requested"),
        }),
        undefined,
        () =>
          requestCommunications(
            {
              contractVersion: "inside-communications-v1",
              operation: "delivery.resolve",
              operationId: input.operationId,
              expectedRevision: input.expectedRevision,
              payload: {
                deliveryId: input.deliveryId,
                partId: input.partId,
                duplicateRiskAccepted: input.duplicateRiskAccepted,
                action: "retry",
              },
            },
            token,
          ),
      ),
  });
}

export function handleResolveTemplate(request: Request): Promise<Response> {
  return handleMutationOperation(request, resolveTemplateOperation, {
    invalidInput,
    execute: (input, token) =>
      executeCommunications(templateSchema, "template", () =>
        requestCommunicationsTemplate(input, token),
      ),
  });
}
