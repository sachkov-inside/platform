import "server-only";
import { z } from "zod";
import {
  requestCommunications,
  requestCommunicationsTemplate,
  type CommunicationsRequest,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedMutation,
  getPlatformAccessToken,
  readLogtoBffConfig,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";
import {
  broadcastResultSchema,
  broadcastListSchema,
  funnelListSchema,
  statisticsResultSchema,
  deliveryListSchema,
  entryListSchema,
  templateResultSchema,
  broadcastSaveInputSchema,
  broadcastActionInputSchema,
} from "../model/broadcasts";
const version = { contractVersion: "inside-communications-v1" } as const;
const problemSchema = z.object({ code: z.string() });
const envelopeSchema = z.object({
  ok: z.literal(true),
  value: z.record(z.string(), z.unknown()),
  trackingBacklog: z.unknown().optional(),
});
const privateHeaders = { "cache-control": "private, no-store", vary: "cookie" };

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
    | "broadcasts.list"
    | "broadcasts.read"
    | "funnels.list"
    | "statistics.read"
    | "deliveries.read"
    | "entries.read",
  schema: z.ZodType,
) {
  try {
    const token = await getPlatformAccessToken(readLogtoBffConfig());
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
          ...(cursor ? { cursor } : {}),
        },
      };
    else if (operation === "statistics.read" || operation === "deliveries.read")
      input = {
        ...base,
        operation,
        payload: {
          ...(cursor ? { cursor } : {}),
          ...(query.get("funnelId")
            ? { funnelId: query.get("funnelId") ?? "" }
            : {}),
          ...(query.get("broadcastId")
            ? { broadcastId: query.get("broadcastId") ?? "" }
            : {}),
        },
      };
    else input = { ...base, operation, payload: cursor ? { cursor } : {} };
    return Response.json(await execute(input, token, schema), {
      headers: privateHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        kind: "error",
        code:
          error instanceof LogtoSessionUnavailableError
            ? "authentication_required"
            : "identity_unavailable",
      },
      { headers: privateHeaders },
    );
  }
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
function formInput(form: FormData): unknown {
  try {
    const value = form.get("input");
    return typeof value === "string" ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}
export function handleBroadcastSave(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = broadcastSaveInputSchema.safeParse(formInput(form));
    return parsed.success
      ? execute(
          {
            ...version,
            ...parsed.data,
            payload: {
              ...parsed.data.payload,
              parts: parsed.data.payload.parts.map((part) => ({
                ...part,
                content: {
                  ...part.content,
                  entities: part.content.entities.map((entity) => ({
                    type: entity.type,
                    offset: entity.offset,
                    length: entity.length,
                    ...(entity.url === undefined ? {} : { url: entity.url }),
                    ...(entity.language === undefined
                      ? {}
                      : { language: entity.language }),
                  })),
                },
              })),
            },
            operation: "broadcasts.save",
          },
          token,
          broadcastResultSchema,
        )
      : { kind: "error", code: "invalid_input" };
  });
}
export function handleBroadcastLaunch(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = broadcastActionInputSchema.safeParse(formInput(form));
    return parsed.success
      ? execute(
          { ...version, ...parsed.data, operation: "broadcasts.launch" },
          token,
          broadcastResultSchema,
        )
      : { kind: "error", code: "invalid_input" };
  });
}
export function handleBroadcastPause(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = broadcastActionInputSchema.safeParse(formInput(form));
    return parsed.success
      ? execute(
          {
            ...version,
            ...parsed.data,
            operation: "broadcasts.lifecycle",
            payload: { ...parsed.data.payload, action: "pause" },
          },
          token,
          broadcastResultSchema,
        )
      : { kind: "error", code: "invalid_input" };
  });
}
export function handleBroadcastResume(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = broadcastActionInputSchema.safeParse(formInput(form));
    return parsed.success
      ? execute(
          {
            ...version,
            ...parsed.data,
            operation: "broadcasts.lifecycle",
            payload: { ...parsed.data.payload, action: "resume" },
          },
          token,
          broadcastResultSchema,
        )
      : { kind: "error", code: "invalid_input" };
  });
}
export function handleBroadcastCancel(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = broadcastActionInputSchema.safeParse(formInput(form));
    return parsed.success
      ? execute(
          {
            ...version,
            ...parsed.data,
            operation: "broadcasts.lifecycle",
            payload: { ...parsed.data.payload, action: "cancel" },
          },
          token,
          broadcastResultSchema,
        )
      : { kind: "error", code: "invalid_input" };
  });
}
export function handleTemplateResolve(request: Request) {
  return handleAuthenticatedMutation(request, async (form, token) => {
    const input = z
      .object({ reference: z.string(), operationId: z.guid() })
      .safeParse(formInput(form));
    if (!input.success) return { kind: "error", code: "invalid_input" };
    try {
      return mapResult(
        await requestCommunicationsTemplate(input.data, token),
        templateResultSchema,
      );
    } catch {
      return { kind: "error", code: "provider_unavailable" };
    }
  });
}
