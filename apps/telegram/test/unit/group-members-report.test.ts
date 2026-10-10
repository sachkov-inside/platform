import { describe, expect, it } from "vitest";
import { collectGroupMembersReport } from "../../src/modules/community/group-members-report.js";

describe("operator group members report", () => {
  it("separates unlinked members, confirmed lack of a right, and unknown rights", async () => {
    const report = await collectGroupMembersReport({
      candidates: [
        { telegramUserId: "101", accountRef: null, identityRef: null },
        {
          telegramUserId: "102",
          accountRef: "account-a",
          identityRef: "identity-a",
        },
        {
          telegramUserId: "103",
          accountRef: "account-b",
          identityRef: "identity-b",
        },
        { telegramUserId: "104", accountRef: null, identityRef: null },
      ],
      canonicalChatId: "-1001",
      telegram: {
        getBotChatMember: () =>
          Promise.resolve({
            kind: "observed",
            value: { status: "administrator" },
          }),
        getChatMember: (_chat, id) =>
          Promise.resolve({
            kind: "observed",
            value: { status: id === "104" ? "left" : "member" },
          }),
      },
      withoutRight: {
        checkedAt: "2026-10-08T10:00:00Z",
        truncated: false,
        identities: new Map([["identity-a", "account-a"]]),
      },
    });
    expect(report.coverage).toBe("known_ids_only");
    expect(report.items).toEqual([
      { telegramUserId: "101", accountRef: null, category: "without_link" },
      {
        telegramUserId: "102",
        accountRef: "account-a",
        category: "without_right",
      },
      {
        telegramUserId: "103",
        accountRef: "account-b",
        category: "right_unknown",
      },
    ]);
    expect(report.notMembers).toBe(1);
  });

  it("keeps provider failures unknown and rejects a stale Account match", async () => {
    const report = await collectGroupMembersReport({
      candidates: [
        { telegramUserId: "101", accountRef: null, identityRef: null },
        {
          telegramUserId: "102",
          accountRef: "new-account",
          identityRef: "identity-a",
        },
      ],
      canonicalChatId: "-1001",
      telegram: {
        getBotChatMember: () =>
          Promise.resolve({
            kind: "observed",
            value: { status: "administrator" },
          }),
        getChatMember: (_chat, id) =>
          Promise.resolve(
            id === "101"
              ? { kind: "unavailable", diagnosticCode: "synthetic_timeout" }
              : {
                  kind: "observed",
                  value: { status: "restricted", isMember: true },
                },
          ),
      },
      withoutRight: {
        checkedAt: "2026-10-08T10:00:00Z",
        truncated: true,
        identities: new Map([["identity-a", "old-account"]]),
      },
    });
    expect(report.items.map((item) => item.category)).toEqual([
      "membership_unknown",
      "right_unknown",
    ]);
    expect(report.platformTruncated).toBe(true);
    expect(report.notMembers).toBe(0);
  });

  it("refuses a non-administrator bot before checking any person", async () => {
    await expect(
      collectGroupMembersReport({
        candidates: [
          { telegramUserId: "101", accountRef: null, identityRef: null },
        ],
        canonicalChatId: "-1001",
        telegram: {
          getBotChatMember: () =>
            Promise.resolve({ kind: "observed", value: { status: "member" } }),
          getChatMember: () =>
            Promise.reject(new Error("must not read people")),
        },
        withoutRight: {
          checkedAt: "2026-10-08T10:00:00Z",
          truncated: false,
          identities: new Map(),
        },
      }),
    ).rejects.toThrow("administrator bot");
  });
});
