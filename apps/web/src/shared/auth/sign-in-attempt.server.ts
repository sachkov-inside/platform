import "server-only";

import { cookies } from "next/headers";

import { readLogtoBffConfig } from "./logto-bff-config.server";
import { decodeSignedCookie, encodeSignedCookie } from "./signed-cookie.server";

interface BaseAuthenticationAttempt {
  readonly id: string;
  readonly expiresAt: string;
}

export type SignInAttempt =
  | (BaseAuthenticationAttempt & {
      readonly kind: "sign_in";
      readonly phase: "provider_pending" | "backend_pending";
    })
  | (BaseAuthenticationAttempt & {
      readonly kind: "reauthentication";
      readonly sessionRef: string;
    });

const ATTEMPT_LIFETIME_SECONDS = 10 * 60;

export function encodeSignInAttemptCookie(attempt: SignInAttempt, secret: string): string {
  validate(attempt);
  return encodeSignedCookie(attempt, secret);
}

export function decodeSignInAttemptCookie(
  value: string,
  secret: string,
  now = new Date(),
): SignInAttempt | undefined {
  return decodeSignedCookie(value, secret, isSignInAttempt, now);
}

export async function writeSignInAttempt(attempt: SignInAttempt): Promise<void> {
  const config = readLogtoBffConfig();
  const definition = attemptCookieDefinition(config.cookieSecure);
  (await cookies()).set(
    definition.name,
    encodeSignInAttemptCookie(attempt, config.cookieSecret),
    {
      ...definition.options,
      expires: new Date(attempt.expiresAt),
      maxAge: ATTEMPT_LIFETIME_SECONDS,
    },
  );
}

export async function readSignInAttempt(): Promise<SignInAttempt | undefined> {
  const config = readLogtoBffConfig();
  const definition = attemptCookieDefinition(config.cookieSecure);
  const value = (await cookies()).get(definition.name)?.value;
  return value === undefined
    ? undefined
    : decodeSignInAttemptCookie(value, config.cookieSecret);
}

export async function clearSignInAttempt(): Promise<void> {
  const config = readLogtoBffConfig();
  const definition = attemptCookieDefinition(config.cookieSecure);
  (await cookies()).set(definition.name, "", {
    ...definition.options,
    expires: new Date(0),
    maxAge: 0,
  });
}

function attemptCookieDefinition(secure: boolean) {
  return {
    name: secure ? "__Host-inside_signin" : "inside_signin",
    options: {
      httpOnly: true,
      path: "/",
      sameSite: "lax" as const,
      secure,
      priority: "high" as const,
    },
  };
}

function validate(attempt: SignInAttempt): void {
  if (!isSignInAttempt(attempt)) {
    throw new TypeError("Sign-in attempt is invalid");
  }
}

function isSignInAttempt(value: unknown): value is SignInAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const common =
    typeof record.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      record.id,
    ) &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt));
  if (!common) {
    return false;
  }
  if (record.kind === "sign_in") {
    return (
      Object.keys(record).length === 4 &&
      (record.phase === "provider_pending" || record.phase === "backend_pending")
    );
  }
  return (
    record.kind === "reauthentication" &&
    Object.keys(record).length === 4 &&
    typeof record.sessionRef === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      record.sessionRef,
    )
  );
}
