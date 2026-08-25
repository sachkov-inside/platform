import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { z } from "zod";

import { readLogtoBffConfig } from "./logto-bff-config.server";
import { decodeSignedCookie, encodeSignedCookie } from "./signed-cookie.server";

const ATTEMPT_LIFETIME_MINUTES = 10;
const ATTEMPT_LIFETIME_SECONDS = minutesInSeconds(ATTEMPT_LIFETIME_MINUTES);

const authenticationAttemptFields = {
  id: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
};
const signInAttemptSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...authenticationAttemptFields,
    kind: z.literal("sign_in"),
    phase: z.enum(["provider_pending", "backend_pending"]),
  }),
  z.strictObject({
    ...authenticationAttemptFields,
    kind: z.literal("reauthentication"),
    sessionRef: z.uuid(),
  }),
]);
export type SignInAttempt = Readonly<z.infer<typeof signInAttemptSchema>>;

export function createSignInAttempt(now = new Date()): SignInAttempt {
  const expiresAt = new Date(now);
  expiresAt.setUTCMinutes(
    expiresAt.getUTCMinutes() + ATTEMPT_LIFETIME_MINUTES,
  );
  return Object.freeze({
    id: randomUUID(),
    expiresAt: expiresAt.toISOString(),
    kind: "sign_in",
    phase: "provider_pending",
  });
}

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
  return signInAttemptSchema.safeParse(value).success;
}

function minutesInSeconds(minutes: number): number {
  return minutes * 60;
}
