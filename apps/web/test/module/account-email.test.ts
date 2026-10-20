import { expect, it, vi } from "vitest";
import { createIdentityAccountClient } from "@/shared/auth/identity-account-client.server";

it("reads the current sign-in email and attaches a verified address through the same user's token", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ sub: "telegram-user", email: "member@example.test" }),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          verificationRecordId: "challenge-1",
          expiresAt: "2030-01-01T00:10:00.000Z",
        },
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const account = createIdentityAccountClient(
    "https://identity.example.test",
    "opaque-user-token",
    request,
  );
  expect(await account.read()).toEqual({
    ok: true,
    email: "member@example.test",
  });
  expect(await account.startEmail("new@example.test")).toEqual({
    ok: true,
    challengeRef: "challenge-1",
  });
  expect(
    await account.confirmEmail({ challengeRef: "challenge-1", code: "123456" }),
  ).toEqual({ ok: true });
  const confirmation = request.mock.calls[2];
  expect(confirmation?.[0]).toBe(
    "https://identity.example.test/api/my-account/first-email/confirm",
  );
  expect(new Headers(confirmation?.[1]?.headers).get("authorization")).toBe(
    "Bearer opaque-user-token",
  );
  expect(confirmation?.[1]?.body).toBe(
    JSON.stringify({ verificationRecordId: "challenge-1", code: "123456" }),
  );
});
