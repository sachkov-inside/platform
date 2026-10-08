import "server-only";
import { z } from "zod";

import {
  requestChangeNotificationPreferences,
  requestNotificationPreferences,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import {
  handleAuthenticatedRead,
  handleAuthenticatedMutation,
} from "@/shared/auth/index.server";

import {
  changeNotificationPreferencesInputSchema,
  notificationFailureCodeSchema,
  notificationPreferencesSchema,
} from "../model/notification-preferences";

const booleanField = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
// Пустое и отсутствующее поле не должны превращаться в допустимую нулевую revision.
const revisionField = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/u)
  .transform(Number);

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
  return handleAuthenticatedMutation(request, async (form, token) => {
    const parsed = changeNotificationPreferencesInputSchema.safeParse({
      operationId: form.get("operationId"),
      expectedRevision: revisionField.safeParse(form.get("expectedRevision"))
        .data,
      email: booleanField.safeParse(form.get("email")).data,
      telegram: booleanField.safeParse(form.get("telegram")).data,
    });
    if (!parsed.success) return { ok: false, code: "invalid_input" };
    try {
      const result = await requestChangeNotificationPreferences(
        parsed.data,
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
        : { ok: false, code: "unavailable" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}
