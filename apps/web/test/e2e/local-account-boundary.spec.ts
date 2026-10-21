import { expect, test } from "@playwright/test";

test("release Web has no local account route and ignores local identity hints", async ({
  request,
}) => {
  expect((await request.get("/__local/accounts")).status()).toBe(404);
  expect((await request.get("/__local/accounts/toolbar.js")).status()).toBe(
    404,
  );
  const response = await request.get(
    "/auth/status?localOwner=true&account=owner",
    {
      headers: {
        "x-local-account": "owner",
        "x-forwarded-host": "127.0.0.1:3000",
        cookie: "inside.local-account=owner",
      },
    },
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    accountId: null,
    canManageMaterials: false,
    state: "guest",
  });
});
