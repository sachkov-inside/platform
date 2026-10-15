import { GrammyError } from "grammy";
import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { GrammyMembershipAdapter } from "../../src/adapters/telegram/grammy-membership.adapter.js";
import { collectGroupMembersReport } from "../../src/modules/community/group-members-report.js";

const sizes = [1, 20, 100] as const;
const corpora = new Map<
  number,
  { telegramUserId: string; accountRef: null; identityRef: null }[]
>();
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
  for (const size of sizes)
    corpora.set(
      size,
      Array.from({ length: size }, (_, index) => ({
        telegramUserId: String(index + 100),
        accountRef: null,
        identityRef: null,
      })),
    );
});
afterAll(() => vi.useRealTimers());
for (const size of sizes) {
  test(`single-member provider contract at ${String(size)} candidates has bounded concurrency and no retry fanout`, async () => {
    let active = 0;
    let peak = 0;
    let memberRequests = 0;
    let identityRequests = 0;
    const telegram = new GrammyMembershipAdapter("synthetic", {
      getMe: () => {
        identityRequests++;
        return Promise.resolve({ id: 1 });
      },
      getChatMember: async (_chatId, userId) => {
        memberRequests++;
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return { status: userId === 1 ? "administrator" : "member" };
      },
    });
    const candidates = corpora.get(size);
    if (candidates === undefined) throw new Error("Missing corpus");
    const report = await collectGroupMembersReport({
      candidates,
      canonicalChatId: "-1001",
      telegram,
      withoutRight: {
        checkedAt: "2026-10-01T00:00:00.000Z",
        truncated: false,
        identities: new Map(),
      },
    });
    expect(report.candidatesChecked).toBe(size);
    expect(report.items).toHaveLength(size);
    expect(report.items.every((row) => row.category === "without_link")).toBe(
      true,
    );
    expect(memberRequests).toBe(size + 1);
    expect(identityRequests).toBe(1);
    expect(peak).toBe(1);
    process.stdout.write(
      `${JSON.stringify({ record: "BC-5", fixture: size, membershipOwnerCalls: size + 1, providerApiRequests: { getMe: identityRequests, getChatMember: memberRequests }, peakProviderConcurrency: peak, providerAutomaticRetries: 0, physicalSqlInReport: 0, httpWireRequests: 0, boundary: "controlled Telegram API double; real owning adapter and report", bulkContract: false })}\n`,
    );
  });
}

test("provider 429 remains unknown with no automatic retry or false right inference", async () => {
  let requests = 0;
  const telegram = new GrammyMembershipAdapter("synthetic", {
    getMe: () => Promise.resolve({ id: 1 }),
    getChatMember: (_chat, user) => {
      requests++;
      if (user === 1) return Promise.resolve({ status: "administrator" });
      return Promise.reject(
        new GrammyError(
          "Synthetic rate limit",
          {
            ok: false,
            error_code: 429,
            description: "Synthetic rate limit",
            parameters: { retry_after: 17 },
          },
          "getChatMember",
          {},
        ),
      );
    },
  });
  const candidates = corpora.get(1);
  if (candidates === undefined) throw new Error("Missing corpus");
  const report = await collectGroupMembersReport({
    candidates,
    canonicalChatId: "-1001",
    telegram,
    withoutRight: {
      checkedAt: "2026-10-01T00:00:00.000Z",
      truncated: false,
      identities: new Map(),
    },
  });
  expect(report.items).toEqual([
    { telegramUserId: "100", accountRef: null, category: "membership_unknown" },
  ]);
  expect(report.notMembers).toBe(0);
  expect(requests).toBe(2);
});
