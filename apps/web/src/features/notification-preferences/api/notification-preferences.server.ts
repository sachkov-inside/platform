import "server-only";
import { z } from "zod";

import {
  requestChangeNotificationPreferences,
  requestNotificationPreferences,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedRead,
  handleMutationOperation,
} from "@/shared/auth/index.server";

import {
  notificationFailureCodeSchema,
  notificationPreferencesSchema,
} from "../model/notification-preferences";

import { changeNotificationPreferencesOperation } from "./notification-preferences.operation";

function failure(result: Extract<BackendTransportResult, { ok: false }>): {
  readonly ok: false;
  readonly code: z.infer<typeof notificationFailureCodeSchema>;
} {
  if (result.response.status === 401)
    return { ok: false, code: "unauthorized" };
  const problem = z
    .object({ code: notificationFailureCodeSchema })
    .safeParse(result.problem);
  return {
    ok: false,
    code: problem.success ? problem.data.code : "unavailable",
  };
}

export async function handleReadNotificationPreferences(): Promise<Response> {
  return handleAuthenticatedRead(async (token) => {
    const result = await requestNotificationPreferences(token);
    if (!result.ok)
      return Response.json(failure(result), {
        status: result.response.status,
      });
    const parsed = notificationPreferencesSchema.safeParse(result.body);
    return parsed.success
      ? Response.json({ ok: true, preferences: parsed.data })
      : new Response(null, { status: 502 });
  });
}

export function handleChangeNotificationPreferences(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(
    request,
    changeNotificationPreferencesOperation,
    {
      invalidInput: () => ({ ok: false, code: "invalid_input" }) as const,
      execute: async (input, token) => {
        try {
          const result = await requestChangeNotificationPreferences(
            input,
            token,
          );
          if (!result.ok) return failure(result);
          const preferences = z
            .object({
              ok: z.literal(true),
              preferences: notificationPreferencesSchema,
            })
            .safeParse(result.body);
          return preferences.success
            ? preferences.data
            : ({ ok: false, code: "unavailable" } as const);
        } catch {
          return { ok: false, code: "unavailable" } as const;
        }
      },
    },
  );
}
