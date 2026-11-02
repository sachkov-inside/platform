import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
  type Accounts,
} from "../../src/modules/accounts/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { CommunityDiscussions } from "../../src/modules/community-discussions/index.js";
import { HttpCommunityDiscussionsProvider } from "../../src/modules/community-discussions/infrastructure/http-community-discussions-provider.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";

registerFixedClock();
const issuer = "https://discussions.test/oidc";
const input = {
  contractVersion: "inside.community-discussions.v1",
  requestId: "read-1",
  operation: "discussions.list",
  limit: 20,
};
let database: TestDatabase;
let accounts: Accounts;
let accountId: string;
let materialsOnly: string;
let unlinked: string;
let discussions: CommunityDiscussions;
const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
  Promise.resolve(
    Response.json({
      contractVersion: input.contractVersion,
      requestId: input.requestId,
      operation: input.operation,
      status: "ok",
      items: [],
      nextCursor: null,
    }),
  ),
);

beforeAll(async () => {
  database = await createMigratedTestDatabase();
  accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "synthetic-discussions-fingerprint-key",
  });
  accountId = (
    await bootstrapOwnerAccount(
      database.prisma,
      { issuer, subject: "author" },
      "communications:manage",
    )
  ).accountId;
  materialsOnly = (
    await bootstrapOwnerAccount(
      database.prisma,
      { issuer, subject: "materials" },
      "materials:manage",
    )
  ).accountId;
  unlinked = (
    await bootstrapOwnerAccount(
      database.prisma,
      { issuer, subject: "unlinked" },
      "communications:manage",
    )
  ).accountId;
  const now = new Date(fixedTestInstant());
  await database.prisma.telegramLinkTransaction.create({
    data: {
      linkRef: randomUUID(),
      accountId,
      principalRef: "synthetic-author",
      providerIdentityRef: "identity-author",
      providerTransactionRef: randomUUID(),
      returnCorrelation: randomUUID(),
      tokenDigest: randomBytes(32).toString("base64url"),
      status: "linked",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });
  discussions = new CommunityDiscussions(
    accounts,
    new TelegramAccountLinks(database.prisma),
    new HttpCommunityDiscussionsProvider(
      {
        endpoint:
          "http://127.0.0.1:9876/integrations/platform/v1/community-discussions",
        secret: "synthetic-discussions-secret",
      },
      fetcher,
    ),
  );
});
beforeEach(async () => {
  fetcher.mockClear();
  await bootstrapOwnerAccount(
    database.prisma,
    { issuer, subject: "author" },
    "communications:manage",
  );
});
afterAll(async () => {
  await database.dispose();
});

test("discussion access binds the confirmed Account and rechecks its actual permission on every replay", async () => {
  await expect(discussions.execute(accountId, input)).resolves.toMatchObject({
    ok: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
    JSON.stringify({
      ...input,
      actor: { accountRef: "synthetic-author" },
    }),
  );
  await database.prisma.accountPermission.deleteMany({
    where: { accountId, permission: "communications:manage" },
  });
  await expect(discussions.execute(accountId, input)).resolves.toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await bootstrapOwnerAccount(
    database.prisma,
    { issuer, subject: "author" },
    "communications:manage",
  );
});

test("materials permission and an absent confirmed Telegram link cannot read discussions", async () => {
  const before = fetcher.mock.calls.length;
  await expect(discussions.execute(materialsOnly, input)).resolves.toEqual({
    ok: false,
    error: { code: "forbidden" },
  });
  await expect(discussions.execute(unlinked, input)).resolves.toEqual({
    ok: false,
    error: { code: "link_required" },
  });
  expect(fetcher).toHaveBeenCalledTimes(before);
});

test("actor injection and invalid mark semantics never reach Telegram", async () => {
  const before = fetcher.mock.calls.length;
  for (const request of [
    { ...input, actor: { accountRef: "forged" } },
    { ...input, accountId: "forged" },
    {
      contractVersion: input.contractVersion,
      requestId: "mark-invalid",
      operation: "discussions.mark",
      discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "used",
      materialUrls: [],
    },
  ]) {
    await expect(discussions.execute(accountId, request)).resolves.toEqual({
      ok: false,
      error: { code: "invalid_input" },
    });
  }
  expect(fetcher).toHaveBeenCalledTimes(before);
});
