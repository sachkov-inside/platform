import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  CourseAssistant,
  currentDataNoticeVersion,
  type CourseAssistantSettings,
} from "../../src/modules/course-assistant/index.js";
import {
  fakeGitHubApp,
  type FakeGitHubApp,
} from "../fixtures/course-assistant-github.js";
import { fakeRepositoryReader } from "../fixtures/course-assistant-repositories.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const participant = randomUUID();
const otherParticipant = randomUUID();
const outsider = randomUUID();
const author = randomUUID();
const repositoryA = {
  id: 101,
  fullName: "learner/agent-course",
  htmlUrl: "https://github.com/learner/agent-course",
};
const repositoryB = {
  id: 102,
  fullName: "learner/second-try",
  htmlUrl: "https://github.com/learner/second-try",
};

describe("Course assistant on PostgreSQL", () => {
  let database: TestDatabase;
  let github: FakeGitHubApp;
  let now: Date;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    for (const id of [participant, otherParticipant, outsider, author]) {
      await database.prisma.account.create({
        data: {
          id,
          logtoIssuer: "https://identity.example.test",
          logtoSubject: id,
        },
      });
    }
    await database.prisma.accountPermission.create({
      data: { accountId: author, permission: "platform:admin" },
    });
  });
  afterAll(async () => {
    await database.dispose();
  });

  function assistant(
    settings: CourseAssistantSettings = {
      enabled: true,
      accountAllowlist: [participant, otherParticipant, author],
    },
  ): CourseAssistant {
    github = fakeGitHubApp();
    now = new Date("2026-09-28T10:00:00.000Z");
    return new CourseAssistant({
      prisma: database.prisma,
      accounts: assembleAccounts({
        prisma: database.prisma,
        emailFingerprintKey: "synthetic-assistant-fingerprint-0000000",
      }),
      settings,
      github,
      repositories: fakeRepositoryReader(),
      practices: {
        describe: () =>
          Promise.reject(new Error("Not used by connection tests")),
        read: () => Promise.reject(new Error("Not used by connection tests")),
      },
      reviewQueue: null,
      clock: () => now,
    });
  }

  async function connect(
    subject: CourseAssistant,
    accountId: string,
    installation: {
      readonly id: number;
      readonly login: string;
      readonly repositories: readonly (typeof repositoryA)[];
    },
  ) {
    github.install(installation.id, {
      login: installation.login,
      repositories: installation.repositories,
    });
    await subject.acknowledgeDataNotice({
      accountId,
      noticeVersion: currentDataNoticeVersion,
    });
    const begun = await subject.beginRepositoryConnection({ accountId });
    if (!begun.ok) throw new Error(`begin failed: ${begun.error.code}`);
    return subject.completeRepositoryConnection({
      accountId,
      state: stateOf(begun.value.installUrl),
      code: github.authorize(installation.login),
      installationId: installation.id,
    });
  }

  test("the assistant stays closed while the setting is off, even for an allowlisted Account", async () => {
    const subject = assistant({
      enabled: false,
      accountAllowlist: [participant, author],
    });

    const unavailable = { ok: false, error: { code: "unavailable" } };
    expect(
      await subject.readParticipantState({ accountId: participant }),
    ).toEqual(unavailable);
    expect(
      await subject.acknowledgeDataNotice({
        accountId: participant,
        noticeVersion: currentDataNoticeVersion,
      }),
    ).toEqual(unavailable);
    expect(
      await subject.beginRepositoryConnection({ accountId: participant }),
    ).toEqual(unavailable);
    expect(
      await subject.listLinkableRepositories({ accountId: participant }),
    ).toEqual(unavailable);
    expect(
      await subject.disconnectRepository({ accountId: participant }),
    ).toEqual(unavailable);
    expect(await subject.listRepositoryLinks({ accountId: author })).toEqual(
      unavailable,
    );
  });

  test("an Account outside the allowlist cannot reach the assistant", async () => {
    const subject = assistant();

    expect(await subject.readParticipantState({ accountId: outsider })).toEqual(
      { ok: false, error: { code: "unavailable" } },
    );
    expect(
      await subject.acknowledgeDataNotice({
        accountId: outsider,
        noticeVersion: currentDataNoticeVersion,
      }),
    ).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(
      await subject.beginRepositoryConnection({ accountId: outsider }),
    ).toEqual({ ok: false, error: { code: "unavailable" } });
  });

  test("the data notice is acknowledged before the first connection", async () => {
    const account = randomUUID();
    await database.prisma.account.create({
      data: {
        id: account,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: account,
      },
    });
    const allowed = assistant({ enabled: true, accountAllowlist: [account] });

    expect(await allowed.readParticipantState({ accountId: account })).toEqual({
      ok: true,
      value: {
        dataNotice: { version: currentDataNoticeVersion, acknowledgedAt: null },
        repositoryLink: null,
      },
    });
    expect(
      await allowed.beginRepositoryConnection({ accountId: account }),
    ).toEqual({ ok: false, error: { code: "data_notice_required" } });
    expect(
      await allowed.acknowledgeDataNotice({
        accountId: account,
        noticeVersion: "2000-01-01",
      }),
    ).toEqual({ ok: false, error: { code: "stale_data_notice" } });

    expect(
      await allowed.acknowledgeDataNotice({
        accountId: account,
        noticeVersion: currentDataNoticeVersion,
      }),
    ).toEqual({
      ok: true,
      value: {
        version: currentDataNoticeVersion,
        acknowledgedAt: "2026-09-28T10:00:00.000Z",
      },
    });
    now = new Date("2026-09-28T11:00:00.000Z");
    const repeated = await allowed.acknowledgeDataNotice({
      accountId: account,
      noticeVersion: currentDataNoticeVersion,
    });
    expect(repeated).toEqual({
      ok: true,
      value: {
        version: currentDataNoticeVersion,
        acknowledgedAt: "2026-09-28T10:00:00.000Z",
      },
    });

    const begun = await allowed.beginRepositoryConnection({
      accountId: account,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.value.installUrl).toMatch(
      /^https:\/\/github\.example\.test\/apps\/inside-course\/installations\/new\?state=[\w-]{43}$/u,
    );
  });

  test("a participant connects, changes and disconnects a repository; history stays", async () => {
    const subject = assistant();

    const completed = await connect(subject, participant, {
      id: 7001,
      login: "learner",
      repositories: [repositoryA, repositoryB],
    });
    expect(completed).toEqual({
      ok: true,
      value: {
        repositoryLink: null,
        repositories: [
          { installationId: 7001, repository: repositoryA },
          { installationId: 7001, repository: repositoryB },
        ],
      },
    });

    const linked = await subject.linkRepository({
      accountId: participant,
      installationId: 7001,
      repositoryId: repositoryA.id,
    });
    expect(linked).toEqual({
      ok: true,
      value: {
        installationId: 7001,
        repository: repositoryA,
        connectedAt: "2026-09-28T10:00:00.000Z",
        access: "available",
      },
    });
    expect(
      await subject.listLinkableRepositories({ accountId: participant }),
    ).toEqual({
      ok: true,
      value: {
        repositories: [
          { installationId: 7001, repository: repositoryA },
          { installationId: 7001, repository: repositoryB },
        ],
      },
    });

    now = new Date("2026-09-28T12:00:00.000Z");
    await subject.linkRepository({
      accountId: participant,
      installationId: 7001,
      repositoryId: repositoryB.id,
    });
    expect(
      await subject.readParticipantState({ accountId: participant }),
    ).toMatchObject({
      ok: true,
      value: {
        repositoryLink: {
          repository: repositoryB,
          connectedAt: "2026-09-28T12:00:00.000Z",
          access: "available",
        },
      },
    });

    now = new Date("2026-09-28T13:00:00.000Z");
    expect(
      await subject.disconnectRepository({ accountId: participant }),
    ).toEqual({ ok: true, value: { disconnected: true } });
    expect(
      await subject.disconnectRepository({ accountId: participant }),
    ).toEqual({ ok: true, value: { disconnected: false } });
    expect(
      await subject.readParticipantState({ accountId: participant }),
    ).toMatchObject({ ok: true, value: { repositoryLink: null } });

    const history = await subject.listRepositoryLinks({ accountId: author });
    expect(history).toEqual({
      ok: true,
      value: {
        links: [
          {
            accountId: participant,
            repositoryFullName: repositoryB.fullName,
            connectedAt: "2026-09-28T12:00:00.000Z",
            disconnectedAt: "2026-09-28T13:00:00.000Z",
          },
          {
            accountId: participant,
            repositoryFullName: repositoryA.fullName,
            connectedAt: "2026-09-28T10:00:00.000Z",
            disconnectedAt: "2026-09-28T12:00:00.000Z",
          },
        ],
      },
    });
  });

  test("parallel choices leave exactly one active Repository Link", async () => {
    const account = randomUUID();
    await database.prisma.account.create({
      data: {
        id: account,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: account,
      },
    });
    const allowed = assistant({ enabled: true, accountAllowlist: [account] });
    await connect(allowed, account, {
      id: 7009,
      login: "racer",
      repositories: [repositoryA, repositoryB],
    });

    const choices = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        allowed.linkRepository({
          accountId: account,
          installationId: 7009,
          repositoryId: index % 2 === 0 ? repositoryA.id : repositoryB.id,
        }),
      ),
    );

    expect(choices.every((choice) => choice.ok)).toBe(true);
    expect(
      await database.prisma.repositoryLink.count({
        where: { accountId: account, disconnectedAt: null },
      }),
    ).toBe(1);
  });

  test("an installation with one repository links it at once", async () => {
    const subject = assistant();
    const completed = await connect(subject, otherParticipant, {
      id: 7002,
      login: "second-learner",
      repositories: [repositoryA],
    });

    expect(completed).toEqual({
      ok: true,
      value: {
        repositoryLink: {
          installationId: 7002,
          repository: repositoryA,
          connectedAt: "2026-09-28T10:00:00.000Z",
          access: "available",
        },
        repositories: [{ installationId: 7002, repository: repositoryA }],
      },
    });
  });

  test("a revoked installation leaves the link visible as unavailable", async () => {
    const subject = assistant();
    await connect(subject, otherParticipant, {
      id: 7003,
      login: "second-learner",
      repositories: [repositoryB],
    });

    github.revoke(7003);

    expect(
      await subject.readParticipantState({ accountId: otherParticipant }),
    ).toMatchObject({
      ok: true,
      value: {
        repositoryLink: { repository: repositoryB, access: "revoked" },
      },
    });
    expect(
      await subject.listLinkableRepositories({ accountId: otherParticipant }),
    ).toEqual({ ok: true, value: { repositories: [] } });

    github.failNextCalls();
    expect(
      await subject.readParticipantState({ accountId: otherParticipant }),
    ).toMatchObject({
      ok: true,
      value: { repositoryLink: { repository: repositoryB, access: "unknown" } },
    });
  });

  test("a repository removed from the installation is no longer available", async () => {
    const subject = assistant();
    await connect(subject, otherParticipant, {
      id: 7004,
      login: "second-learner",
      repositories: [repositoryA],
    });

    github.install(7004, {
      login: "second-learner",
      repositories: [repositoryB],
    });

    expect(
      await subject.readParticipantState({ accountId: otherParticipant }),
    ).toMatchObject({
      ok: true,
      value: {
        repositoryLink: { repository: repositoryA, access: "revoked" },
      },
    });
  });

  test("a connection started by another Account, expired or already completed is refused", async () => {
    const subject = assistant();
    github.install(7005, { login: "learner", repositories: [repositoryA] });
    for (const accountId of [participant, otherParticipant]) {
      await subject.acknowledgeDataNotice({
        accountId,
        noticeVersion: currentDataNoticeVersion,
      });
    }
    const begun = await subject.beginRepositoryConnection({
      accountId: participant,
    });
    if (!begun.ok) throw new Error(begun.error.code);
    const state = stateOf(begun.value.installUrl);

    expect(
      await subject.completeRepositoryConnection({
        accountId: otherParticipant,
        state,
        code: github.authorize("learner"),
        installationId: 7005,
      }),
    ).toEqual({ ok: false, error: { code: "invalid_connection" } });

    expect(
      await subject.completeRepositoryConnection({
        accountId: participant,
        state,
        code: github.authorize("learner"),
        installationId: 7005,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await subject.completeRepositoryConnection({
        accountId: participant,
        state,
        code: github.authorize("learner"),
        installationId: 7005,
      }),
    ).toEqual({ ok: false, error: { code: "invalid_connection" } });

    const late = await subject.beginRepositoryConnection({
      accountId: participant,
    });
    if (!late.ok) throw new Error(late.error.code);
    now = new Date("2026-09-28T10:16:00.000Z");
    expect(
      await subject.completeRepositoryConnection({
        accountId: participant,
        state: stateOf(late.value.installUrl),
        code: github.authorize("learner"),
        installationId: 7005,
      }),
    ).toEqual({ ok: false, error: { code: "invalid_connection" } });
  });

  test("an installation the participant does not own, or one with write access, is refused", async () => {
    const subject = assistant();
    github.install(7006, {
      login: "somebody-else",
      repositories: [repositoryA],
    });
    github.install(7007, {
      login: "learner",
      repositories: [repositoryA],
      writable: true,
    });
    await subject.acknowledgeDataNotice({
      accountId: participant,
      noticeVersion: currentDataNoticeVersion,
    });

    for (const [installationId, code] of [
      [7006, "installation_not_owned"],
      [7007, "write_access_requested"],
    ] as const) {
      const begun = await subject.beginRepositoryConnection({
        accountId: participant,
      });
      if (!begun.ok) throw new Error(begun.error.code);
      expect(
        await subject.completeRepositoryConnection({
          accountId: participant,
          state: stateOf(begun.value.installUrl),
          code: github.authorize("learner"),
          installationId,
        }),
      ).toEqual({ ok: false, error: { code } });
    }

    expect(
      await subject.linkRepository({
        accountId: participant,
        installationId: 7006,
        repositoryId: repositoryA.id,
      }),
    ).toEqual({ ok: false, error: { code: "repository_not_available" } });
  });

  test("one participant cannot link a repository through another participant's installation", async () => {
    const subject = assistant();
    await connect(subject, participant, {
      id: 7008,
      login: "learner",
      repositories: [repositoryA, repositoryB],
    });
    await subject.acknowledgeDataNotice({
      accountId: otherParticipant,
      noticeVersion: currentDataNoticeVersion,
    });

    expect(
      await subject.linkRepository({
        accountId: otherParticipant,
        installationId: 7008,
        repositoryId: repositoryA.id,
      }),
    ).toEqual({ ok: false, error: { code: "repository_not_available" } });
  });

  test("only the author sees every participant's repository links", async () => {
    const subject = assistant();

    expect(
      await subject.listRepositoryLinks({ accountId: participant }),
    ).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(
      await subject.listRepositoryLinks({ accountId: author }),
    ).toMatchObject({ ok: true });
  });
});

function stateOf(installUrl: string): string {
  const state = new URL(installUrl).searchParams.get("state");
  if (state === null) throw new Error("install URL has no state");
  return state;
}
