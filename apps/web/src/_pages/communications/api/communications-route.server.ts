import "server-only";

import { z } from "zod";

import {
  requestCommunications,
  requestCommunicationsTemplate,
} from "@/shared/api/backend/communications.server";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import {
  commandSchema,
  deliveryListSchema,
  funnelListSchema,
  funnelSchema,
  introSchema,
  lifecycleSchema,
  previewSchema,
  resolveDeliverySchema,
  saveIntroSchema,
  saveSchema,
  templateReferenceSchema,
  templateSchema,
} from "../model/communications";

import { executeForm } from "./response.server";

export function handleListFunnels(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(
      form,
      z.object({ cursor: z.string().optional() }),
      funnelListSchema,
      undefined,
      (input) =>
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
  );
}

export function handleReadFunnel(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(
      form,
      z.object({ funnelId: z.guid() }),
      funnelSchema,
      "funnel",
      (input) =>
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
  );
}

export function handleSaveFunnel(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(form, saveSchema, funnelSchema, "funnel", (input) =>
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
  );
}

export function handlePreviewFunnel(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(form, commandSchema, previewSchema, "preview", (input) =>
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
  );
}

export function handlePublishFunnel(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(form, commandSchema, funnelSchema, "funnel", (input) =>
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
  );
}

export function handleChangeFunnelLifecycle(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(form, lifecycleSchema, funnelSchema, "funnel", (input) =>
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
  );
}

export function handleReadIntro(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(form, z.object({}), introSchema, "intro", () =>
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
  );
}

export function handleSaveIntro(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(form, saveIntroSchema, introSchema, "intro", (input) =>
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
  );
}

export function handleReadDeliveries(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(
      form,
      z.object({ funnelId: z.guid(), cursor: z.string().optional() }),
      deliveryListSchema,
      undefined,
      (input) =>
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
  );
}

export function handleSkipDelivery(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(
      form,
      resolveDeliverySchema,
      z.object({
        deliveryId: z.guid(),
        partId: z.guid(),
        outcome: z.literal("skipped"),
      }),
      undefined,
      (input) =>
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
  );
}

export function handleRetryDelivery(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(
      form,
      resolveDeliverySchema,
      z.object({
        deliveryId: z.guid(),
        partId: z.guid(),
        outcome: z.literal("retry_requested"),
      }),
      undefined,
      (input) =>
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
  );
}

export function handleResolveTemplate(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeForm(
      form,
      templateReferenceSchema,
      templateSchema,
      "template",
      (input) => requestCommunicationsTemplate(input, token),
    ),
  );
}
