import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockAccountRecords,
  type AccountsPrisma,
  type AccountsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { VerifiedAccountIdentity } from "../accounts/verified-logto-identity.js";
import {
  canFinalizeLoginEmail,
  canReserveLoginEmail,
  matchesLoginEmailInteraction,
} from "../../features/login-email-identity/login-email-policy.js";
import {
  changeLoginEmailState,
  createLoginEmailIntent,
  findLoginEmailIntent,
  isLoginEmailReserved,
  isLoginEmailInteractionUsed,
  readLoginEmailIntent,
  reserveLoginEmailIntent,
  selectLoginEmailCandidate,
  type LoginEmailRecord,
} from "../../infrastructure/postgres/login-email-intents.js";
import {
  fingerprintEmail,
  validLogtoIdentity,
} from "../../shared/account-input.js";
import {
  loginEmailIdentityContractVersion,
  type loginEmailIdentityResultSchema,
} from "./login-email-identity.contract.js";
import type { LoginEmailNativeAuthority } from "./login-email-native-authority.js";

const interactionSchema = z.strictObject({
  ownerIdentity: z.strictObject({
    issuer: z.url().regex(/^https:\/\//u),
    subject: z.string().min(1).max(500),
  }),
  interactionRef: z.string().min(1).max(128),
  browserBindingDigest: z.string().regex(/^[a-f0-9]{64}$/u),
});
const candidateSchema = interactionSchema.extend({
  intentRef: z.uuidv4(),
  email: z.email().max(320),
  verificationRef: z.string().min(1).max(128),
  telegramProof: z.strictObject({
    subjectRef: z.uuidv4(),
    requestRef: z.uuidv4(),
    approvedAt: z.iso.datetime(),
  }),
});
const commitSchema = interactionSchema.extend({
  intentRef: z.uuidv4(),
  email: z.email().max(320),
  verificationRef: z.string().min(1).max(128),
  state: z.literal("attached"),
});

type Result = z.infer<typeof loginEmailIdentityResultSchema>;
type Failure = "unavailable" | "identity_conflict" | "expired";
interface Command {
  readonly identity: VerifiedAccountIdentity;
  readonly intentRef: string;
  /** Existing BFF request context; never persisted or interpreted as authentication here. */
  readonly nativeContext: unknown;
}
function failure(status: Failure): Result {
  return { contractVersion: loginEmailIdentityContractVersion, status };
}
function result(intent: LoginEmailRecord): Result {
  return {
    contractVersion: loginEmailIdentityContractVersion,
    intentRef: intent.intentRef,
    status: intent.state,
    expiresAt: intent.expiresAt.toISOString(),
  };
}

/** Accounts operation ledger. Provider I/O stays outside database locks; no new identity/session. */
export class LoginEmailIdentity {
  constructor(
    private readonly prisma: AccountsPrismaClient,
    private readonly emailFingerprintKey: string,
    private readonly nativeAuthority?: LoginEmailNativeAuthority,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(command: {
    readonly identity: VerifiedAccountIdentity;
    readonly commandRef: string;
    readonly nativeContext: unknown;
  }): Promise<Result> {
    if (
      this.nativeAuthority === undefined ||
      !z.uuidv4().safeParse(command.commandRef).success ||
      !validLogtoIdentity(command.identity)
    )
      return failure("unavailable");
    try {
      const proof = interactionSchema.safeParse(
        await this.nativeAuthority.readInteraction(command),
      );
      if (
        !proof.success ||
        proof.data.ownerIdentity.issuer !== command.identity.issuer ||
        proof.data.ownerIdentity.subject !== command.identity.subject
      )
        return failure("unavailable");
      return await this.locked(command.identity, async (tx) => {
        const account = await tx.account.findUnique({
          where: {
            logtoIssuer_logtoSubject: {
              logtoIssuer: command.identity.issuer,
              logtoSubject: command.identity.subject,
            },
          },
        });
        if (account?.telegramSubjectRef == null) return failure("unavailable");
        const retry = await findLoginEmailIntent(
          tx,
          account.id,
          command.commandRef,
        );
        if (retry !== undefined) {
          const intent = await readLoginEmailIntent(
            tx,
            retry.intentRef,
            command.identity,
          );
          return intent !== undefined &&
            matchesLoginEmailInteraction(intent, proof.data)
            ? result(intent)
            : failure("unavailable");
        }
        if (
          account.emailFingerprint !== null ||
          (await isLoginEmailInteractionUsed(tx, proof.data.interactionRef))
        )
          return failure("unavailable");
        const active = await findLoginEmailIntent(tx, account.id);
        if (active !== undefined) {
          if (active.state !== "pending") return failure("unavailable");
          await changeLoginEmailState(
            tx,
            active.intentRef,
            "superseded",
            this.now(),
          );
        }
        const now = this.now();
        const intent: LoginEmailRecord = {
          ...proof.data,
          intentRef: randomUUID(),
          commandRef: command.commandRef,
          accountId: account.id,
          telegramSubjectRef: account.telegramSubjectRef,
          state: "pending",
          candidateFingerprint: null,
          verificationRef: null,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
        };
        await createLoginEmailIntent(tx, intent, now);
        return result(intent);
      });
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "beginLoginEmailIdentity" },
        error,
        failure("unavailable"),
      );
    }
  }

  async selectCandidate(command: Command): Promise<Result> {
    if (!this.available(command)) return failure("unavailable");
    try {
      const proof = candidateSchema.safeParse(
        await this.nativeAuthority?.readVerifiedCandidate(command),
      );
      if (!proof.success) return failure("unavailable");
      const fingerprint = fingerprintEmail(
        proof.data.email,
        this.emailFingerprintKey,
      );
      if (fingerprint === undefined) return failure("unavailable");
      return await this.locked(command.identity, async (tx) => {
        const intent = await readLoginEmailIntent(
          tx,
          command.intentRef,
          command.identity,
        );
        if (
          intent === undefined ||
          !matchesLoginEmailInteraction(intent, proof.data) ||
          intent.intentRef !== proof.data.intentRef
        )
          return failure("unavailable");
        if (intent.state !== "pending") return result(intent);
        if (this.now() >= intent.expiresAt) return failure("expired");
        if (intent.candidateFingerprint !== null) {
          if (
            intent.candidateFingerprint === fingerprint &&
            intent.verificationRef === proof.data.verificationRef
          )
            return result(intent);
          await changeLoginEmailState(
            tx,
            intent.intentRef,
            "superseded",
            this.now(),
          );
          return result({ ...intent, state: "superseded" });
        }
        await selectLoginEmailCandidate(
          tx,
          intent.intentRef,
          fingerprint,
          proof.data.verificationRef,
          this.now(),
        );
        return result(intent);
      });
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "selectLoginEmailCandidate" },
        error,
        failure("unavailable"),
      );
    }
  }

  async reserve(command: Command): Promise<Result> {
    if (!this.available(command)) return failure("unavailable");
    try {
      const proof = candidateSchema.safeParse(
        await this.nativeAuthority?.readVerifiedCandidate(command),
      );
      if (!proof.success) return failure("unavailable");
      const fingerprint = fingerprintEmail(
        proof.data.email,
        this.emailFingerprintKey,
      );
      if (fingerprint === undefined) return failure("unavailable");
      return await this.locked(
        command.identity,
        async (tx) => {
          const intent = await readLoginEmailIntent(
            tx,
            command.intentRef,
            command.identity,
          );
          if (
            intent === undefined ||
            !matchesLoginEmailInteraction(intent, proof.data) ||
            intent.intentRef !== proof.data.intentRef
          )
            return failure("unavailable");
          // A retry cannot reauthorize a possibly committed operation. It must reconcile.
          if (
            intent.state === "reserved" ||
            intent.state === "reconciliation_required"
          ) {
            await changeLoginEmailState(
              tx,
              intent.intentRef,
              "reconciliation_required",
              this.now(),
            );
            return result({ ...intent, state: "reconciliation_required" });
          }
          if (intent.state !== "pending") return result(intent);
          if (this.now() >= intent.expiresAt) return failure("expired");
          if (
            !canReserveLoginEmail(intent, proof.data, fingerprint, this.now())
          )
            return failure("unavailable");
          const account = await tx.account.findUnique({
            where: { id: intent.accountId },
          });
          const owner = await tx.account.findUnique({
            where: { emailFingerprint: fingerprint },
            select: { id: true },
          });
          if (
            account?.emailFingerprint !== null ||
            account.telegramSubjectRef !== intent.telegramSubjectRef ||
            owner !== null ||
            (await isLoginEmailReserved(tx, fingerprint))
          )
            return failure("identity_conflict");
          await reserveLoginEmailIntent(
            tx,
            intent.intentRef,
            proof.data.telegramProof,
            this.now(),
          );
          return result({ ...intent, state: "reserved" });
        },
        fingerprint,
      );
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "reserveLoginEmailIdentity" },
        error,
        failure("unavailable"),
      );
    }
  }

  /** Reconciliation and the normal response use the same authoritative finalization path. */
  async finalize(command: Command): Promise<Result> {
    return this.reconcile(command);
  }

  async reconcile(command: Command): Promise<Result> {
    if (!this.available(command)) return failure("unavailable");
    try {
      const snapshot = await readLoginEmailIntent(
        this.prisma,
        command.intentRef,
        command.identity,
      );
      if (snapshot === undefined) return failure("unavailable");
      const interaction = interactionSchema.safeParse(
        await this.nativeAuthority?.readInteraction(command),
      );
      if (
        !interaction.success ||
        !matchesLoginEmailInteraction(snapshot, interaction.data)
      )
        return failure("unavailable");
      const raw = await this.nativeAuthority
        ?.readCommittedEmail(command)
        .catch((error: unknown) =>
          dependencyFailure(
            { module: "accounts", operation: "readCommittedLoginEmail" },
            error,
            undefined,
          ),
        );
      const proof = commitSchema.safeParse(raw);
      const fingerprint = proof.success
        ? fingerprintEmail(proof.data.email, this.emailFingerprintKey)
        : undefined;
      // Lock the ledger's candidate, never a mismatched receipt's email. No provider I/O in tx.
      return await this.locked(
        command.identity,
        async (tx) => {
          const intent = await readLoginEmailIntent(
            tx,
            command.intentRef,
            command.identity,
          );
          if (intent === undefined) return failure("unavailable");
          if (
            intent.state !== "reserved" &&
            intent.state !== "reconciliation_required" &&
            intent.state !== "finalized"
          )
            return result(intent);
          if (
            !proof.success ||
            fingerprint === undefined ||
            !canFinalizeLoginEmail(intent, proof.data, fingerprint)
          ) {
            if (intent.state === "finalized") return result(intent);
            await changeLoginEmailState(
              tx,
              intent.intentRef,
              "reconciliation_required",
              this.now(),
            );
            return result({ ...intent, state: "reconciliation_required" });
          }
          const account = await tx.account.findUnique({
            where: { id: intent.accountId },
          });
          const owner = await tx.account.findUnique({
            where: { emailFingerprint: fingerprint },
            select: { id: true },
          });
          if (
            account === null ||
            account.telegramSubjectRef !== intent.telegramSubjectRef ||
            (account.emailFingerprint !== null &&
              account.emailFingerprint !== fingerprint) ||
            (owner !== null && owner.id !== intent.accountId)
          ) {
            if (intent.state !== "finalized")
              await changeLoginEmailState(
                tx,
                intent.intentRef,
                "reconciliation_required",
                this.now(),
              );
            return failure("identity_conflict");
          }
          if (intent.state !== "finalized") {
            await changeLoginEmailState(
              tx,
              intent.intentRef,
              "finalized",
              this.now(),
            );
            await tx.account.update({
              where: { id: intent.accountId },
              data: { emailFingerprint: fingerprint },
            });
          }
          return result({ ...intent, state: "finalized" });
        },
        snapshot.candidateFingerprint ?? undefined,
      );
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "reconcileLoginEmailIdentity" },
        error,
        failure("unavailable"),
      );
    }
  }

  private available(command: Command): boolean {
    return (
      this.nativeAuthority !== undefined &&
      validLogtoIdentity(command.identity) &&
      z.uuidv4().safeParse(command.intentRef).success
    );
  }
  private locked(
    identity: VerifiedAccountIdentity,
    operation: (tx: AccountsPrisma) => Promise<Result>,
    fingerprint?: string,
  ): Promise<Result> {
    return this.prisma.$transaction(async (tx) => {
      await lockAccountRecords(tx, [
        `logto:${JSON.stringify([identity.issuer, identity.subject])}`,
        ...(fingerprint === undefined ? [] : [`email:${fingerprint}` as const]),
      ]);
      return operation(tx);
    });
  }
}
