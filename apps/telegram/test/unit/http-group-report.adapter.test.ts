import { describe, expect, it } from "vitest";
import { readGroupReportRights } from "../../src/adapters/platform/http-group-report.adapter.js";

describe("Platform operator report", () => {
  it("uses the operator bearer and validates the existing response", async () => {
    const result = await readGroupReportRights(
      "https://platform.invalid/community-entitlements/members-without-right",
      "synthetic-operator",
      (_url, init) => {
        expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("error");
        expect(init?.headers).toEqual({
          authorization: "Bearer synthetic-operator",
          accept: "application/json",
        });
        return Promise.resolve(
          Response.json({
            checkedAt: "2026-10-08T10:00:00Z",
            truncated: false,
            items: [
              {
                accountId: "00000000-0000-4000-8000-000000000001",
                telegramIdentityRef: "identity-a",
                observedAt: "2026-10-07T10:00:00Z",
              },
            ],
          }),
        );
      },
    );
    expect(result.identities.get("identity-a")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it.each([401, 403, 503])(
    "refuses HTTP %s instead of treating it as an empty list",
    async (status) => {
      await expect(
        readGroupReportRights(
          "https://platform.invalid/report",
          "synthetic",
          () => Promise.resolve(new Response(null, { status })),
        ),
      ).rejects.toThrow("unavailable");
    },
  );

  it("refuses a malformed response and cleartext remote credentials", async () => {
    await expect(
      readGroupReportRights(
        "https://platform.invalid/report",
        "synthetic",
        () => Promise.resolve(Response.json({ items: [] })),
      ),
    ).rejects.toThrow();
    await expect(
      readGroupReportRights("http://platform.invalid/report", "synthetic", () =>
        Promise.reject(new Error("must not send token")),
      ),
    ).rejects.toThrow("Unsafe");
  });
});
