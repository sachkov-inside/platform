import "server-only";
import { z } from "zod";
import {
  requestCommunications,
  requestCommunicationsTemplate,
  type CommunicationsRequest,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";
import {
  type Part,
  savedPostListSchema,
  savedPostSampleSchema,
  broadcastResultSchema,
  broadcastListSchema,
  funnelListSchema,
  statisticsResultSchema,
  deliveryListSchema,
  entryListSchema,
  templateResultSchema,
} from "../model/broadcasts";
import {
  cancelBroadcastOperation,
  launchBroadcastOperation,
  pauseBroadcastOperation,
  resolveBroadcastTemplateOperation,
  resumeBroadcastOperation,
  samplePostOperation,
  saveBroadcastOperation,
  savePostOperation,
} from "./broadcasts.operation";
import { hasText } from "@/shared/lib/text";
const version = { contractVersion: "inside-communications-v1" } as const;
const problemSchema = z.object({ code: z.string() });
const envelopeSchema = z.object({
  ok: z.literal(true),
  value: z.record(z.string(), z.unknown()),
  trackingBacklog: z.unknown().optional(),
});

async function execute<T>(
  input: CommunicationsRequest,
  token: string,
  schema: z.ZodType<T>,
): Promise<T | { kind: "error"; code: string }> {
  try {
    return mapResult(await requestCommunications(input, token), schema);
  } catch {
    return { kind: "error", code: "provider_unavailable" };
  }
}
function mapResult<T>(
  result: Awaited<ReturnType<typeof requestCommunications>>,
  schema: z.ZodType<T>,
): T | { kind: "error"; code: string } {
  if (!result.ok)
    return {
      kind: "error",
      code:
        problemSchema.safeParse(result.problem).data?.code ??
        "provider_unavailable",
    };
  const envelope = envelopeSchema.safeParse(result.body);
  if (!envelope.success) return { kind: "error", code: "invalid_response" };
  const parsed = schema.safeParse({
    kind: "ready",
    ...envelope.data.value,
    trackingBacklog: envelope.data.trackingBacklog ?? { kind: "unavailable" },
  });
  return parsed.success
    ? parsed.data
    : { kind: "error", code: "invalid_response" };
}
async function read(
  request: Request,
  operation:
    | "templates.list"
    | "broadcasts.list"
    | "broadcasts.read"
    | "funnels.list"
    | "statistics.read"
    | "deliveries.read"
    | "entries.read",
  schema: z.ZodType,
) {
  return handleAuthenticatedRead(async (token) => {
    const query = new URL(request.url).searchParams;
    const cursor = query.get("cursor") ?? undefined;
    let input: CommunicationsRequest;
    const base = {
      ...version,
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
    };
    if (operation === "broadcasts.read")
      input = {
        ...base,
        operation,
        payload: { broadcastId: query.get("broadcastId") ?? "" },
      };
    else if (operation === "entries.read")
      input = {
        ...base,
        operation,
        payload: {
          contactId: query.get("contactId") ?? "",
          ...(hasText(cursor) ? { cursor } : {}),
        },
      };
    else if (operation === "statistics.read" || operation === "deliveries.read")
      input = {
        ...base,
        operation,
        payload: {
          ...(hasText(cursor) ? { cursor } : {}),
          ...(hasText(query.get("funnelId"))
            ? { funnelId: query.get("funnelId") ?? "" }
            : {}),
          ...(hasText(query.get("broadcastId"))
            ? { broadcastId: query.get("broadcastId") ?? "" }
            : {}),
        },
      };
    else
      input = {
        ...base,
        operation,
        payload: hasText(cursor) ? { cursor } : {},
      };
    const response = await requestCommunications(input, token);
    const result = mapResult(response, schema);
    return Response.json(result, {
      status: response.ok ? 200 : response.response.status,
    });
  });
}
export const handleBroadcastList = (request: Request) =>
  read(request, "broadcasts.list", broadcastListSchema);
export const handleBroadcastRead = (request: Request) =>
  read(request, "broadcasts.read", broadcastResultSchema);
export const handleFunnelList = (request: Request) =>
  read(request, "funnels.list", funnelListSchema);
export const handleStatisticsRead = (request: Request) =>
  read(request, "statistics.read", statisticsResultSchema);
export const handleDeliveryList = (request: Request) =>
  read(request, "deliveries.read", deliveryListSchema);
export const handleEntryList = (request: Request) =>
  read(request, "entries.read", entryListSchema);
const invalidInput = () => ({ kind: "error", code: "invalid_input" }) as const;
export function handleBroadcastSave(request: Request) {
  return handleMutationOperation(request, saveBroadcastOperation, {
    invalidInput,
    execute: (input, token) =>
      execute(
        {
          ...version,
          ...input,
          payload: {
            ...input.payload,
            parts: input.payload.parts.map((part) => ({
              ...part,
              content: providerContent(part.content),
            })),
          },
          operation: "broadcasts.save",
        },
        token,
        broadcastResultSchema,
      ),
  });
}
export function handleBroadcastLaunch(request: Request) {
  return handleMutationOperation(request, launchBroadcastOperation, {
    invalidInput,
    execute: (input, token) =>
      execute(
        { ...version, ...input, operation: "broadcasts.launch" },
        token,
        broadcastResultSchema,
      ),
  });
}
export function handleBroadcastPause(request: Request) {
  return handleMutationOperation(request, pauseBroadcastOperation, {
    invalidInput,
    execute: (input, token) =>
      execute(
        {
          ...version,
          ...input,
          operation: "broadcasts.lifecycle",
          payload: { ...input.payload, action: "pause" },
        },
        token,
        broadcastResultSchema,
      ),
  });
}
export function handleBroadcastResume(request: Request) {
  return handleMutationOperation(request, resumeBroadcastOperation, {
    invalidInput,
    execute: (input, token) =>
      execute(
        {
          ...version,
          ...input,
          operation: "broadcasts.lifecycle",
          payload: { ...input.payload, action: "resume" },
        },
        token,
        broadcastResultSchema,
      ),
  });
}
export function handleBroadcastCancel(request: Request) {
  return handleMutationOperation(request, cancelBroadcastOperation, {
    invalidInput,
    execute: (input, token) =>
      execute(
        {
          ...version,
          ...input,
          operation: "broadcasts.lifecycle",
          payload: { ...input.payload, action: "cancel" },
        },
        token,
        broadcastResultSchema,
      ),
  });
}
export function handleTemplateResolve(request: Request) {
  return handleMutationOperation(request, resolveBroadcastTemplateOperation, {
    invalidInput,
    execute: async (input, token) => {
      try {
        return mapResult(
          await requestCommunicationsTemplate(input, token),
          templateResultSchema,
        );
      } catch {
        return { kind: "error", code: "provider_unavailable" };
      }
    },
  });
}

export function handleSavedPostList(request: Request) {
  return read(request, "templates.list", savedPostListSchema);
}
export function handleSavedPostSave(request: Request) {
  return handleMutationOperation(request, savePostOperation, {
    invalidInput,
    execute: (input, token) =>
      execute(
        {
          ...version,
          ...input,
          payload: {
            ...input.payload,
            content: providerContent(input.payload.content),
          },
          operation: "templates.save",
        },
        token,
        templateResultSchema,
      ),
  });
}
export function handleSavedPostSample(request: Request) {
  return handleMutationOperation(request, samplePostOperation, {
    invalidInput,
    execute: (input, token) =>
      execute(
        { ...version, ...input, operation: "templates.testSend" },
        token,
        savedPostSampleSchema,
      ),
  });
}

function providerContent(content: Part["content"]) {
  return {
    ...content,
    buttons: content.buttons.map(({ text, url, row }) => ({
      text,
      url,
      ...(row === undefined ? {} : { row }),
    })),
    entities: content.entities.map(
      ({ type, offset, length, url, language }) => ({
        type,
        offset,
        length,
        ...(url === undefined ? {} : { url }),
        ...(language === undefined ? {} : { language }),
      }),
    ),
  };
}
