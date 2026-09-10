import "server-only";
import { z } from "zod";

import type { BackendTransportResult } from "@/shared/api/backend/index.server";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import {
  billingFailureCodeSchema,
  type BillingFailureCode,
} from "../model/billing-contract";

/**
 * Ошибка billing переносится без потери смысла: код Problem Details бэкенда, а когда его нет —
 * ближайший ожидаемый исход по статусу. Неизвестный ответ не выдаётся за успех.
 */
export function billingFailureCode(
  result: Extract<BackendTransportResult, { ok: false }>,
): BillingFailureCode {
  const problem = z
    .object({ code: billingFailureCodeSchema })
    .safeParse(result.problem);
  if (problem.success) return problem.data.code;
  switch (result.response.status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 400:
      return "invalid_request";
    default:
      return "unavailable";
  }
}

/** Ответ billing всегда принадлежит одному Account: он приватен и не кэшируется. */
export const privateBillingHeaders = {
  "cache-control": "private, no-store",
  vary: "cookie",
};

/** Закрытый исход без тела бэкенда: тот же конверт, что и у успешного ответа. */
export function billingFailureResponse(
  code: BillingFailureCode,
  status: number,
): Response {
  return Response.json(
    { ok: false, code },
    { headers: privateBillingHeaders, status },
  );
}

/**
 * Один продуктовый read через собственный маршрут: тело бэкенда проверяется схемой, а не
 * принимается на веру из генерируемых типов.
 */
export async function readBillingResource(
  execute: () => Promise<BackendTransportResult>,
  schema: z.ZodType,
): Promise<Response> {
  let result: BackendTransportResult;
  try {
    result = await execute();
  } catch {
    return billingFailureResponse("unavailable", 503);
  }
  if (!result.ok)
    return billingFailureResponse(
      billingFailureCode(result),
      result.response.status,
    );
  const parsed = schema.safeParse(result.body);
  return parsed.success
    ? Response.json(
        { ok: true, value: parsed.data },
        { headers: privateBillingHeaders },
      )
    : billingFailureResponse("unavailable", 502);
}

/**
 * Одна billing-команда: разбор собственного входа, вызов её use case и закрытый исход.
 * Повтор с прежним `operationId` безопасен, потому что решение принимает сервер.
 */
export async function executeBillingCommand<
  Input extends z.ZodType,
  Value extends z.ZodType,
>(
  form: FormData,
  inputSchema: Input,
  valueSchema: Value,
  execute: (input: z.infer<Input>) => Promise<BackendTransportResult>,
): Promise<
  | { readonly ok: true; readonly value: z.infer<Value> }
  | { readonly ok: false; readonly code: BillingFailureCode }
> {
  let raw: unknown;
  try {
    raw = JSON.parse(z.string().parse(form.get("input")));
  } catch {
    return { ok: false, code: "invalid_request" };
  }
  const input = inputSchema.safeParse(raw);
  if (!input.success) return { ok: false, code: "invalid_request" };
  let result: BackendTransportResult;
  try {
    result = await execute(input.data);
  } catch {
    return { ok: false, code: "unavailable" };
  }
  if (!result.ok) return { ok: false, code: billingFailureCode(result) };
  const parsed = valueSchema.safeParse(result.body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, code: "unavailable" };
}

/** Собственный read Account: без действующей сессии он не существует, а не «пуст». */
export async function readAuthenticatedBilling(
  execute: (accessToken: string) => Promise<BackendTransportResult>,
  schema: z.ZodType,
): Promise<Response> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return error instanceof LogtoSessionUnavailableError
      ? billingFailureResponse("unauthorized", 401)
      : billingFailureResponse("unavailable", 503);
  }
  return readBillingResource(() => execute(accessToken), schema);
}
