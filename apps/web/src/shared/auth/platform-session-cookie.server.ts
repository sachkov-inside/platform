import "server-only";

import { cookies } from "next/headers";

import { decodeSignedCookie, encodeSignedCookie } from "./signed-cookie.server";

export interface PlatformSessionContext {
  readonly sessionRef: string;
  readonly expiresAt: string;
}

type RuntimeMode = "development" | "production" | "test";

const LOCAL_COOKIE_NAME = "inside_session";
const PRODUCTION_COOKIE_NAME = "__Host-inside_session";

export function encodePlatformSessionCookie(
  context: PlatformSessionContext,
  secret: string,
): string {
  if (!isPlatformSessionContext(context)) {
    throw new TypeError("Platform Session context is invalid");
  }
  return encodeSignedCookie(context, secret);
}

export function decodePlatformSessionCookie(
  value: string,
  secret: string,
  now = new Date(),
): PlatformSessionContext | undefined {
  return decodeSignedCookie(value, secret, isPlatformSessionContext, now);
}

export function platformSessionCookieDefinition(mode: RuntimeMode) {
  const production = mode === "production";
  return Object.freeze({
    name: production ? PRODUCTION_COOKIE_NAME : LOCAL_COOKIE_NAME,
    options: Object.freeze({
      httpOnly: true,
      path: "/",
      sameSite: "lax" as const,
      secure: production,
      priority: "high" as const,
    }),
  });
}

export async function readPlatformSession(): Promise<PlatformSessionContext | undefined> {
  const definition = platformSessionCookieDefinition(runtimeMode());
  const value = (await cookies()).get(definition.name)?.value;
  return value === undefined
    ? undefined
    : decodePlatformSessionCookie(value, readCookieSecret());
}

export async function writePlatformSession(context: PlatformSessionContext): Promise<void> {
  const definition = platformSessionCookieDefinition(runtimeMode());
  const expires = new Date(context.expiresAt);
  (await cookies()).set(
    definition.name,
    encodePlatformSessionCookie(context, readCookieSecret()),
    { ...definition.options, expires },
  );
}

export async function clearPlatformSession(): Promise<void> {
  const definition = platformSessionCookieDefinition(runtimeMode());
  (await cookies()).set(definition.name, "", {
    ...definition.options,
    expires: new Date(0),
    maxAge: 0,
  });
}

function readCookieSecret(): string {
  return process.env.LOGTO_COOKIE_SECRET ?? "";
}

function runtimeMode(): RuntimeMode {
  const mode = process.env.NODE_ENV;
  return mode === "development" || mode === "test" ? mode : "production";
}

function isPlatformSessionContext(value: unknown): value is PlatformSessionContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    isUuid(record.sessionRef) &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}
