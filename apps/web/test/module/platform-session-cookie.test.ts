import { describe, expect, it } from "vitest";

import {
  decodePlatformSessionCookie,
  encodePlatformSessionCookie,
  platformSessionCookieDefinition,
} from "@/shared/auth/index.server";

const secret = "platform-session-cookie-test-secret-32chars";
const context = {
  sessionRef: "72000000-0000-4000-8000-000000000001",
  expiresAt: "2026-09-01T06:00:00.000Z",
};

describe("Platform Session cookie", () => {
  it("stores only an opaque sessionRef in an integrity-protected seven-day context", () => {
    const encoded = encodePlatformSessionCookie(context, secret);

    expect(encoded).not.toContain(context.sessionRef);
    expect(encoded).not.toContain("token");
    expect(
      decodePlatformSessionCookie(encoded, secret, new Date("2026-08-25T06:00:00.000Z")),
    ).toEqual(context);
  });

  it("rejects tampering, expiry and a wrong secret", () => {
    const encoded = encodePlatformSessionCookie(context, secret);

    expect(
      decodePlatformSessionCookie(`${encoded}tampered`, secret, new Date("2026-08-25T06:00:00.000Z")),
    ).toBeUndefined();
    expect(
      decodePlatformSessionCookie(encoded, `${secret}-wrong`, new Date("2026-08-25T06:00:00.000Z")),
    ).toBeUndefined();
    expect(
      decodePlatformSessionCookie(encoded, secret, new Date("2026-09-01T06:00:00.000Z")),
    ).toBeUndefined();
  });

  it("uses host-bound secure production attributes and explicit local attributes", () => {
    expect(platformSessionCookieDefinition("production")).toEqual({
      name: "__Host-inside_session",
      options: {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: true,
        priority: "high",
      },
    });
    expect(platformSessionCookieDefinition("development")).toMatchObject({
      name: "inside_session",
      options: { httpOnly: true, secure: false, sameSite: "lax", path: "/" },
    });
  });
});
