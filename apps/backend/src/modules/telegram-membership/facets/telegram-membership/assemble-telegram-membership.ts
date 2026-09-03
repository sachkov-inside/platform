import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  Prisma,
  type TelegramMembershipPrisma,
  type TelegramMembershipPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { accountId, type AccountId } from "../../../accounts/index.js";
import type {
  MembershipEntitlements,
  MembershipEvidenceAcceptance,
} from "../../../membership-entitlements/index.js";
import type {
  TelegramLinkProvider,
  TelegramLinkProviderConfirmation,
  TelegramLinkProviderRegistration,
} from "../../ports/telegram-link-provider.js";
import type {
  AcceptTelegramEvidenceCommand,
  AccountMembershipState,
  AccountTelegramLinkState,
  AccountTelegramMembershipResult,
  TelegramLinkResult,
  TelegramLinkState,
  TelegramMembership,
} from "./telegram-membership.interface.js";

const principalEnvelopeSchema = z.looseObject({
  principalRef: z.string().min(1).max(256),
});
const linkRefSchema = z.uuid();
const advisoryLockRowsSchema = z
  .array(z.object({ lock: z.string() }).strict())
  .length(1);

export interface TelegramMembershipDependencies {
  readonly botStartUrl: string;
  readonly clock?: () => Date;
  readonly linkLifetimeMs: number;
  readonly membershipAcquisitionUrl: string;
  readonly membershipEntitlements: MembershipEntitlements;
  readonly membershipSupportUrl?: string;
  readonly prisma: TelegramMembershipPrismaClient;
  readonly provider: TelegramLinkProvider;
}

export function assembleTelegramMembership(
  dependencies: TelegramMembershipDependencies,
): TelegramMembership {
  assertDependencies(dependencies);
  const clock = dependencies.clock ?? (() => new Date());
  const membership: TelegramMembership = {
    async readAccountPresentation(query) {
      try {
        return await readAccountPresentation(
          dependencies,
          query.accountId,
          clock(),
        );
      } catch {
        return { ok: false, error: { code: "unavailable" } };
      }
    },
    async beginLink(command) {
      try {
        return await beginLink(dependencies, command.accountId, clock());
      } catch {
        return failure("unavailable");
      }
    },
    async confirmLink(command) {
      try {
        return await confirmLink(
          dependencies,
          command.accountId,
          command.linkRef,
          clock(),
        );
      } catch {
        return failure("unavailable");
      }
    },
    async acceptEvidence(command) {
      try {
        return await acceptEvidence(dependencies, command);
      } catch {
        return { ok: false, error: { code: "unavailable" } };
      }
    },
  };
  return Object.freeze(membership);
}

async function beginLink(
  dependencies: TelegramMembershipDependencies,
  account: string,
  now: Date,
): Promise<TelegramLinkResult> {
  const claim = await dependencies.prisma.$transaction(async (prisma) => {
    const lockKey = `telegram-membership-link:${account}`;
    advisoryLockRowsSchema.parse(
      await prisma.$queryRaw(Prisma.sql`
        select
          pg_advisory_xact_lock(
            hashtextextended(${lockKey}, 0::bigint)
          )::text as lock
      `),
    );
    const current = await currentLinkForBegin(prisma, account, now);
    if (current !== undefined) return { current } as const;

    const linkRef = randomUUID();
    const principalRef = randomUUID();
    const returnCorrelation = randomUUID();
    const rawToken = randomBytes(32).toString("base64url");
    const tokenDigest = createHash("sha256")
      .update(rawToken)
      .digest("base64url");
    const expiresAt = new Date(now.getTime() + dependencies.linkLifetimeMs);
    await prisma.telegramLinkTransaction.create({
      data: {
        accountId: account,
        createdAt: now,
        expiresAt,
        linkRef,
        principalRef,
        providerIdentityRef: null,
        providerTransactionRef: null,
        returnCorrelation,
        status: "registering",
        tokenDigest,
        updatedAt: now,
      },
    });
    return {
      created: {
        expiresAt,
        linkRef,
        principalRef,
        rawToken,
        returnCorrelation,
        tokenDigest,
      },
    } as const;
  });
  if ("current" in claim) return success(claim.current);
  const {
    expiresAt,
    linkRef,
    principalRef,
    rawToken,
    returnCorrelation,
    tokenDigest,
  } = claim.created;

  let registration: TelegramLinkProviderRegistration;
  try {
    registration = await dependencies.provider.register({
      accountRef: principalRef,
      expiresAt,
      returnCorrelation,
      tokenDigest,
    });
  } catch {
    registration = { kind: "unavailable" };
  }

  if (
    registration.kind === "registered" &&
    (registration.returnCorrelation !== returnCorrelation ||
      registration.expiresAt.getTime() !== expiresAt.getTime())
  ) {
    registration = { kind: "recovery_required" };
  }
  if (registration.kind !== "registered") {
    const state = registrationState(registration.kind);
    await updateLinkState(dependencies, linkRef, state, now);
    return success(linkState(linkRef, expiresAt, publicStatus(state)));
  }

  await dependencies.prisma.telegramLinkTransaction.update({
    where: { linkRef },
    data: {
      providerTransactionRef: registration.linkTransactionRef,
      status: "pending",
      updatedAt: now,
    },
  });
  return success({
    ...linkState(linkRef, expiresAt, "pending"),
    deepLink: linkWithStartToken(dependencies.botStartUrl, rawToken),
  });
}

async function readAccountPresentation(
  dependencies: TelegramMembershipDependencies,
  account: AccountId,
  now: Date,
): Promise<AccountTelegramMembershipResult> {
  const [access, linkedTransaction, latestTransaction] = await Promise.all([
    dependencies.membershipEntitlements.resolveForAccess(account),
    dependencies.prisma.telegramLinkTransaction.findFirst({
      where: { accountId: account, status: "linked" },
      orderBy: [{ updatedAt: "desc" }, { linkRef: "desc" }],
    }),
    dependencies.prisma.telegramLinkTransaction.findFirst({
      where: { accountId: account },
      orderBy: [{ updatedAt: "desc" }, { linkRef: "desc" }],
    }),
  ]);

  return {
    ok: true,
    presentation: {
      link: accountLinkState(
        linkedTransaction ?? latestTransaction,
        now,
        dependencies.membershipSupportUrl,
      ),
      membership: accountMembershipState(
        access,
        dependencies.membershipAcquisitionUrl,
      ),
    },
  };
}

type PersistedLink = NonNullable<
  Awaited<
    ReturnType<
      TelegramMembershipPrismaClient["telegramLinkTransaction"]["findFirst"]
    >
  >
>;

function accountLinkState(
  transaction: PersistedLink | null,
  now: Date,
  supportUrl: string | undefined,
): AccountTelegramLinkState {
  if (transaction === null) return { kind: "unlinked" };
  if (transaction.status === "linked") return { kind: "linked" };
  if (transaction.status === "conflict") {
    return {
      kind: "conflict",
      ...(supportUrl === undefined ? {} : { supportUrl }),
    };
  }
  if (transaction.status === "recovery_required") {
    return {
      kind: "recovery-required",
      recovery: {
        kind: "support",
        ...(supportUrl === undefined ? {} : { url: supportUrl }),
      },
    };
  }
  if (
    transaction.status === "expired" ||
    transaction.status === "replayed" ||
    (transaction.expiresAt <= now &&
      (transaction.status === "pending" ||
        transaction.status === "registering" ||
        transaction.status === "unavailable"))
  ) {
    return {
      kind: "retryable",
      reason: transaction.status === "replayed" ? "replayed" : "expired",
    };
  }
  if (transaction.status === "pending") {
    return {
      expiresAt: transaction.expiresAt.toISOString(),
      kind: "linking",
      linkRef: transaction.linkRef,
    };
  }
  if (transaction.status === "registering") {
    return { kind: "unavailable", retry: { kind: "refresh" } };
  }
  return {
    kind: "unavailable",
    retry:
      transaction.providerTransactionRef === null
        ? { kind: "refresh" }
        : { kind: "confirm", linkRef: transaction.linkRef },
  };
}

function accountMembershipState(
  state: Awaited<ReturnType<MembershipEntitlements["resolveForAccess"]>>,
  acquisitionUrl: string,
): AccountMembershipState {
  switch (state.kind) {
    case "active":
      return { kind: "active" };
    case "expired":
    case "required":
      return { acquisitionUrl, kind: "inactive" };
    case "stale":
      return { kind: "stale" };
    case "unavailable":
      return { kind: "unavailable" };
  }
}

async function currentLinkForBegin(
  prisma: TelegramMembershipPrisma,
  account: string,
  now: Date,
): Promise<TelegramLinkState | undefined> {
  const linked = await prisma.telegramLinkTransaction.findFirst({
    where: { accountId: account, status: "linked" },
    orderBy: [{ updatedAt: "desc" }, { linkRef: "desc" }],
  });
  if (linked !== null) {
    return linkState(linked.linkRef, linked.expiresAt, "linked");
  }
  const latest = await prisma.telegramLinkTransaction.findFirst({
    where: { accountId: account },
    orderBy: [{ updatedAt: "desc" }, { linkRef: "desc" }],
  });
  if (latest === null) return undefined;
  if (
    latest.status === "conflict" ||
    latest.status === "recovery_required"
  ) {
    return linkState(latest.linkRef, latest.expiresAt, publicStatus(latest.status));
  }
  if (latest.expiresAt <= now) return undefined;
  if (latest.status === "pending") {
    return linkState(latest.linkRef, latest.expiresAt, "pending");
  }
  if (latest.status === "registering") {
    return linkState(latest.linkRef, latest.expiresAt, "unavailable");
  }
  if (latest.status === "unavailable") {
    return linkState(latest.linkRef, latest.expiresAt, "unavailable");
  }
  return undefined;
}

async function confirmLink(
  dependencies: TelegramMembershipDependencies,
  account: string,
  linkRef: string,
  now: Date,
): Promise<TelegramLinkResult> {
  if (!linkRefSchema.safeParse(linkRef).success) {
    return failure("invalid_input");
  }
  const transaction = await dependencies.prisma.telegramLinkTransaction.findFirst(
    { where: { accountId: account, linkRef } },
  );
  if (transaction === null) {
    return failure("link_not_found");
  }
  if (
    transaction.expiresAt <= now &&
    transaction.status !== "linked" &&
    transaction.status !== "conflict" &&
    transaction.status !== "recovery_required"
  ) {
    await updateLinkState(dependencies, linkRef, "expired", now);
    return success(linkState(linkRef, transaction.expiresAt, "expired"));
  }
  if (
    transaction.status !== "pending" &&
    !(
      transaction.status === "unavailable" &&
      transaction.providerTransactionRef !== null
    )
  ) {
    return success(
      linkState(linkRef, transaction.expiresAt, publicStatus(transaction.status)),
    );
  }
  if (transaction.providerTransactionRef === null) {
    await updateLinkState(dependencies, linkRef, "recovery_required", now);
    return success(
      linkState(linkRef, transaction.expiresAt, "recovery-required"),
    );
  }

  let confirmation: TelegramLinkProviderConfirmation;
  try {
    confirmation = await dependencies.provider.confirm({
      accountRef: transaction.principalRef,
      linkTransactionRef: transaction.providerTransactionRef,
      returnCorrelation: transaction.returnCorrelation,
    });
  } catch {
    confirmation = { kind: "unavailable" };
  }
  if (
    confirmation.kind === "linked" &&
    (confirmation.linkTransactionRef !== transaction.providerTransactionRef ||
      confirmation.returnCorrelation !== transaction.returnCorrelation)
  ) {
    confirmation = { kind: "recovery_required" };
  }

  if (confirmation.kind === "linked") {
    const binding = await dependencies.membershipEntitlements.bindPrincipal({
      accountId: accountId(transaction.accountId),
      principalRef: transaction.principalRef,
    });
    if (!binding.ok) {
      const state =
        binding.error.code === "conflict" ? "conflict" : "unavailable";
      await updateLinkState(dependencies, linkRef, state, now);
      return success(linkState(linkRef, transaction.expiresAt, state));
    }
    try {
      await dependencies.prisma.telegramLinkTransaction.update({
        where: { linkRef },
        data: {
          providerIdentityRef: confirmation.telegramIdentityRef,
          status: "linked",
          updatedAt: now,
        },
      });
      return success(linkState(linkRef, transaction.expiresAt, "linked"));
    } catch {
      await updateLinkState(dependencies, linkRef, "conflict", now);
      return success(linkState(linkRef, transaction.expiresAt, "conflict"));
    }
  }

  const state = confirmationState(confirmation.kind);
  await updateLinkState(dependencies, linkRef, state, now);
  return success(linkState(linkRef, transaction.expiresAt, publicStatus(state)));
}

async function acceptEvidence(
  dependencies: TelegramMembershipDependencies,
  command: AcceptTelegramEvidenceCommand,
): Promise<MembershipEvidenceAcceptance> {
  const envelope = principalEnvelopeSchema.safeParse(command.evidence);
  if (!envelope.success) {
    return { ok: false, error: { code: "invalid_evidence" } };
  }
  const link = await dependencies.prisma.telegramLinkTransaction.findUnique({
    where: { principalRef: envelope.data.principalRef },
  });
  if (
    link !== null &&
    (link.status === "pending" ||
      link.status === "registering" ||
      link.status === "unavailable")
  ) {
    return { ok: false, error: { code: "unavailable" } };
  }
  if (link === null || link.status !== "linked") {
    return { ok: false, error: { code: "principal_mismatch" } };
  }
  return dependencies.membershipEntitlements.acceptEvidence({
    accountId: accountId(link.accountId),
    deliveryId: command.deliveryId,
    evidence: command.evidence,
    source: command.source,
  });
}

function updateLinkState(
  dependencies: TelegramMembershipDependencies,
  linkRef: string,
  state: DatabaseLinkStatus,
  updatedAt: Date,
): Promise<unknown> {
  return dependencies.prisma.telegramLinkTransaction.update({
    where: { linkRef },
    data: { status: state, updatedAt },
  });
}

type DatabaseLinkStatus =
  | "conflict"
  | "expired"
  | "linked"
  | "pending"
  | "recovery_required"
  | "registering"
  | "replayed"
  | "unavailable";

function registrationState(
  kind: Exclude<TelegramLinkProviderRegistration["kind"], "registered">,
): DatabaseLinkStatus {
  return kind;
}

function confirmationState(
  kind: Exclude<TelegramLinkProviderConfirmation["kind"], "linked">,
): DatabaseLinkStatus {
  return kind === "pending" ? "pending" : kind;
}

function publicStatus(state: string): TelegramLinkState["status"] {
  switch (state) {
    case "conflict":
    case "expired":
    case "linked":
    case "pending":
    case "replayed":
    case "unavailable":
      return state;
    case "recovery_required":
    case "registering":
      return "recovery-required";
    default:
      return "recovery-required";
  }
}

function linkState(
  linkRef: string,
  expiresAt: Date,
  status: TelegramLinkState["status"],
): TelegramLinkState {
  return { expiresAt: expiresAt.toISOString(), linkRef, status };
}

function success(state: TelegramLinkState): TelegramLinkResult {
  return { ok: true, state };
}

function failure(
  code: "invalid_input" | "link_not_found" | "unavailable",
): TelegramLinkResult {
  return { ok: false, error: { code } };
}

function linkWithStartToken(botStartUrl: string, rawToken: string): string {
  const url = new URL(botStartUrl);
  url.searchParams.set("start", rawToken);
  return url.toString();
}

function assertDependencies(
  dependencies: TelegramMembershipDependencies,
): void {
  const startUrl = new URL(dependencies.botStartUrl);
  const acquisitionUrl = new URL(dependencies.membershipAcquisitionUrl);
  const supportUrl =
    dependencies.membershipSupportUrl === undefined
      ? undefined
      : new URL(dependencies.membershipSupportUrl);
  if (
    startUrl.protocol !== "https:" ||
    startUrl.hostname !== "t.me" ||
    startUrl.pathname === "/" ||
    startUrl.search.length > 0 ||
    startUrl.hash.length > 0 ||
    !Number.isInteger(dependencies.linkLifetimeMs) ||
    dependencies.linkLifetimeMs < 60_000 ||
    dependencies.linkLifetimeMs > 10 * 60_000 ||
    !["http:", "https:"].includes(acquisitionUrl.protocol) ||
    (supportUrl !== undefined && !["http:", "https:"].includes(supportUrl.protocol))
  ) {
    throw new TypeError("Telegram Membership dependencies are invalid");
  }
}
