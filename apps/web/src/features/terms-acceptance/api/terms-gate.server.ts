import "server-only";

import { redirect } from "next/navigation";

import { requestTermsAcceptance } from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { internalRoute } from "@/shared/routing/internal-route";

import {
  termsStatusSchema,
  welcomePath,
  type TermsStatus,
} from "../model/terms-acceptance";

export type TermsGate =
  | Readonly<{ kind: "guest" }>
  | Readonly<{ kind: "accepted" }>
  | Readonly<{ kind: "required"; status: TermsStatus }>
  | Readonly<{ kind: "unavailable" }>;

/** Принята ли действующая редакция условий. Гость и истёкшая сессия экрана не видят. */
export async function readTermsGate(
  accessToken: string | undefined,
): Promise<TermsGate> {
  if (accessToken === undefined) return { kind: "guest" };
  try {
    const result = await requestTermsAcceptance(accessToken);
    if (!result.ok)
      return result.response.status === 401
        ? { kind: "guest" }
        : { kind: "unavailable" };
    const status = termsStatusSchema.safeParse(result.body);
    if (!status.success) return { kind: "unavailable" };
    return status.data.accepted
      ? { kind: "accepted" }
      : { kind: "required", status: status.data };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Серверный маршрут кабинета или покупки открывает экран первого входа, пока действующая редакция
 * не принята. Недоступность проверки маршрут не закрывает: тот же отказ вернёт сам backend.
 */
export async function redirectUntilTermsAccepted(
  returnTo: string,
): Promise<void> {
  const gate = await readTermsGate(await getOptionalPlatformAccessToken());
  if (gate.kind === "required") redirect(internalRoute(welcomePath(returnTo)));
}
