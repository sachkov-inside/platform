import { createHash, randomInt, randomUUID } from "node:crypto";
import { paymentModes } from "@inside/legal";
import { z } from "zod";
import type { AccountsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { acquireAccountLocks } from "../../infrastructure/postgres/advisory-locks.js";
import type { billingContactProtection } from "../../infrastructure/billing-contact-protection.js";
import {
  acceptConsentsSchema,
  acceptConsentsResultSchema,
  confirmContactSchema,
  confirmContactResultSchema,
  contactFailure,
  acceptedLegalDocumentSchema,
  legalDocumentSchema,
  startContactSchema,
  type ReadConsentResult,
  type AcceptConsentsResult,
  type ConfirmContactResult,
  type LegalDocument,
  type ReadContactResult,
  type StartContactResult,
} from "./billing-contact.contract.js";

const challengeLifetimeMs = 10 * 60 * 1_000;
const resendCooldownMs = 60 * 1_000;
const sendWindowMs = 60 * 60 * 1_000;
const recipientWindowMs = 24 * sendWindowMs;
const maxAccountSendsPerHour = 5;
const maxRecipientSendsPerDay = 10;
const maxCodeAttempts = 5;

export interface BillingContactDependencies {
  readonly prisma: AccountsPrismaClient;
  readonly protection: ReturnType<typeof billingContactProtection> | undefined;
  readonly sendCode:
    | ((message: {
        readonly email: string;
        readonly code: string;
        readonly challengeRef: string;
      }) => Promise<void>)
    | undefined;
  readonly documents: readonly LegalDocument[];
  readonly now: () => Date;
}

/** Account-bound contact proof; never changes a Logto identity or grants payment authority. */
export class BillingContact {
  private readonly documents: readonly LegalDocument[];
  constructor(private readonly dependencies: BillingContactDependencies) {
    this.documents = z.array(legalDocumentSchema).parse(dependencies.documents);
    for (const document of this.documents) {
      if (
        document.digest !==
        createHash("sha256").update(document.text).digest("hex")
      )
        throw new Error("Legal document digest mismatch");
    }
    for (const mode of paymentModes) {
      const kinds = this.documents
        .filter((document) => document.appliesTo.includes(mode))
        .map((document) => document.kind);
      if (new Set(kinds).size !== kinds.length)
        throw new Error(`Duplicate legal document kind for ${mode}`);
    }
  }

  async read(accountId: string): Promise<ReadContactResult> {
    if (!z.uuid().safeParse(accountId).success)
      return contactFailure("forbidden");
    try {
      const { prisma, protection } = this.dependencies;
      if (!(await prisma.account.findUnique({ where: { id: accountId } })))
        return contactFailure("forbidden");
      const row = await prisma.billingContact.findUnique({
        where: { accountId },
      });
      if (!row?.emailCiphertext || !row.verifiedAt)
        return { ok: true, contact: null, documents: [...this.documents] };
      if (!protection) return contactFailure("provider_unavailable");
      return {
        ok: true,
        contact: {
          email: protection.open(accountId, row.emailCiphertext),
          revision: row.revision,
          verifiedAt: row.verifiedAt.toISOString(),
        },
        documents: [...this.documents],
      };
    } catch {
      return contactFailure("internal_error");
    }
  }

  async readConsent(
    accountId: string,
    evidenceRef: string,
  ): Promise<ReadConsentResult> {
    if (!z.uuid().safeParse(accountId).success)
      return contactFailure("forbidden");
    if (!z.uuid().safeParse(evidenceRef).success)
      return contactFailure("not_found");
    try {
      const row =
        await this.dependencies.prisma.billingConsentEvidence.findFirst({
          where: { id: evidenceRef, accountId },
        });
      if (!row) return contactFailure("not_found");
      return {
        ok: true,
        evidence: {
          evidenceRef: row.id,
          contextRef: row.contextRef,
          acceptedAt: row.acceptedAt.toISOString(),
          document: acceptedLegalDocumentSchema.parse({
            kind: row.kind,
            documentId: row.documentId,
            version: row.documentVersion,
            digest: row.documentDigest,
            text: row.documentText,
            url: row.documentUrl,
          }),
        },
      };
    } catch {
      return contactFailure("internal_error");
    }
  }

  async start(accountId: string, input: unknown): Promise<StartContactResult> {
    const parsed = startContactSchema.safeParse(input);
    if (!parsed.success) return contactFailure("invalid_input");
    if (!z.uuid().safeParse(accountId).success)
      return contactFailure("forbidden");
    const { prisma, protection, sendCode, now } = this.dependencies;
    if (!protection || !sendCode) return contactFailure("provider_unavailable");
    const command = parsed.data;
    const fingerprint = protection.digest(`start:${JSON.stringify(command)}`);
    const recipientFingerprint = protection.digest(
      `recipient:${command.email}`,
    );
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const challengeRef = randomUUID();
    try {
      const reserved = await prisma.$transaction(async (transaction) => {
        await acquireAccountLocks(transaction, [
          `billing-account:${accountId}`,
          `billing-recipient:${recipientFingerprint}`,
        ]);
        if (
          !(await transaction.account.findUnique({ where: { id: accountId } }))
        )
          return contactFailure("forbidden");
        const previous = await transaction.billingContactChallenge.findUnique({
          where: {
            accountId_operationId: {
              accountId,
              operationId: command.operationId,
            },
          },
        });
        if (previous)
          return previous.fingerprint === fingerprint
            ? {
                ok: true as const,
                challengeRef: previous.id,
                expiresAt: previous.expiresAt.toISOString(),
                delivery:
                  previous.delivery === "sent"
                    ? ("sent" as const)
                    : ("unknown" as const),
                send: false,
              }
            : contactFailure("operation_conflict");
        if (
          await transaction.billingContactCommand.findUnique({
            where: {
              accountId_operationId: {
                accountId,
                operationId: command.operationId,
              },
            },
          })
        )
          return contactFailure("operation_conflict");
        const contact = await transaction.billingContact.findUnique({
          where: { accountId },
        });
        if ((contact?.revision ?? 0) !== command.expectedRevision)
          return contactFailure("revision_conflict");
        const instant = now();
        const recent = await transaction.billingContactChallenge.findMany({
          where: {
            accountId,
            createdAt: { gt: new Date(instant.getTime() - sendWindowMs) },
          },
          orderBy: { createdAt: "desc" },
          take: maxAccountSendsPerHour,
        });
        const recipientCount = await transaction.billingContactChallenge.count({
          where: {
            recipientFingerprint,
            createdAt: { gt: new Date(instant.getTime() - recipientWindowMs) },
          },
        });
        if (
          recent.length >= maxAccountSendsPerHour ||
          recipientCount >= maxRecipientSendsPerDay ||
          (recent[0] &&
            instant.getTime() - recent[0].createdAt.getTime() <
              resendCooldownMs)
        )
          return contactFailure("rate_limited");
        const expiresAt = new Date(instant.getTime() + challengeLifetimeMs);
        await transaction.billingContactChallenge.create({
          data: {
            id: challengeRef,
            accountId,
            operationId: command.operationId,
            fingerprint,
            recipientFingerprint,
            emailCiphertext: protection.seal(accountId, command.email),
            codeDigest: protection.digest(
              `code:${accountId}:${challengeRef}:${code}`,
            ),
            baseRevision: command.expectedRevision,
            createdAt: instant,
            expiresAt,
            delivery: "unknown",
          },
        });
        await transaction.billingContact.upsert({
          where: { accountId },
          create: { accountId, challengeRef },
          update: { challengeRef },
        });
        return {
          ok: true as const,
          challengeRef,
          expiresAt: expiresAt.toISOString(),
          delivery: "unknown" as const,
          send: true,
        };
      });
      if (!reserved.ok) return reserved;
      let delivery: "sent" | "unknown" = reserved.delivery;
      if (reserved.send) {
        // Reservation commits before external I/O. A crash/timeout is never automatically resent.
        try {
          await sendCode({ email: command.email, code, challengeRef });
          await prisma.billingContactChallenge.update({
            where: { id: challengeRef },
            data: { delivery: "sent" },
          });
          delivery = "sent";
        } catch {
          delivery = "unknown";
        }
      }
      return {
        ok: true,
        challengeRef: reserved.challengeRef,
        expiresAt: reserved.expiresAt,
        delivery,
      };
    } catch {
      return contactFailure("internal_error");
    }
  }

  async confirm(
    accountId: string,
    input: unknown,
  ): Promise<ConfirmContactResult> {
    const parsed = confirmContactSchema.safeParse(input);
    if (!parsed.success) return contactFailure("invalid_input");
    if (!z.uuid().safeParse(accountId).success)
      return contactFailure("forbidden");
    const { prisma, protection, now } = this.dependencies;
    if (!protection) return contactFailure("provider_unavailable");
    const command = parsed.data;
    const fingerprint = protection.digest(`confirm:${JSON.stringify(command)}`);
    try {
      return await prisma.$transaction(async (transaction) => {
        await acquireAccountLocks(transaction, [
          `billing-account:${accountId}`,
        ]);
        if (
          !(await transaction.account.findUnique({ where: { id: accountId } }))
        )
          return contactFailure("forbidden");
        const previous = await transaction.billingContactCommand.findUnique({
          where: {
            accountId_operationId: {
              accountId,
              operationId: command.operationId,
            },
          },
        });
        if (previous)
          return previous.fingerprint === fingerprint
            ? confirmContactResultSchema.parse(previous.result)
            : contactFailure("operation_conflict");
        if (
          await transaction.billingContactChallenge.findUnique({
            where: {
              accountId_operationId: {
                accountId,
                operationId: command.operationId,
              },
            },
          })
        )
          return contactFailure("operation_conflict");
        const challenge = await transaction.billingContactChallenge.findFirst({
          where: { id: command.challengeRef, accountId },
        });
        const contact = await transaction.billingContact.findUnique({
          where: { accountId },
        });
        const instant = now();
        let result: ConfirmContactResult;
        if (
          !challenge ||
          !contact ||
          contact.challengeRef !== challenge.id ||
          contact.revision !== challenge.baseRevision ||
          challenge.confirmedAt ||
          challenge.expiresAt <= instant ||
          challenge.attempts >= maxCodeAttempts
        ) {
          result = contactFailure("challenge_invalid");
        } else {
          const matches = protection.matches(
            challenge.codeDigest,
            protection.digest(
              `code:${accountId}:${challenge.id}:${command.code}`,
            ),
          );
          await transaction.billingContactChallenge.update({
            where: { id: challenge.id },
            data: {
              attempts: { increment: 1 },
              ...(matches ? { confirmedAt: instant } : {}),
            },
          });
          if (!matches) result = contactFailure("challenge_invalid");
          else {
            const verified = await transaction.billingContact.update({
              where: { accountId },
              data: {
                emailCiphertext: challenge.emailCiphertext,
                verifiedAt: instant,
                revision: { increment: 1 },
                challengeRef: null,
              },
            });
            result = { ok: true, revision: verified.revision };
          }
        }
        await transaction.billingContactCommand.create({
          data: {
            accountId,
            operationId: command.operationId,
            fingerprint,
            result,
          },
        });
        return result;
      });
    } catch {
      return contactFailure("internal_error");
    }
  }

  async acceptConsents(
    accountId: string,
    input: unknown,
  ): Promise<AcceptConsentsResult> {
    const parsed = acceptConsentsSchema.safeParse(input);
    if (
      !parsed.success ||
      new Set(parsed.data.documents.map((document) => document.kind)).size !==
        parsed.data.documents.length
    )
      return contactFailure("invalid_input");
    if (!z.uuid().safeParse(accountId).success)
      return contactFailure("forbidden");
    const { prisma, protection, now } = this.dependencies;
    if (!protection) return contactFailure("provider_unavailable");
    const command = parsed.data;
    const fingerprint = protection.digest(
      `consents:${JSON.stringify(command)}`,
    );
    try {
      return await prisma.$transaction(async (transaction) => {
        await acquireAccountLocks(transaction, [
          `billing-account:${accountId}`,
        ]);
        if (
          !(await transaction.account.findUnique({ where: { id: accountId } }))
        )
          return contactFailure("forbidden");
        const previous = await transaction.billingContactCommand.findUnique({
          where: {
            accountId_operationId: {
              accountId,
              operationId: command.operationId,
            },
          },
        });
        if (previous)
          return previous.fingerprint === fingerprint
            ? acceptConsentsResultSchema.parse(previous.result)
            : contactFailure("operation_conflict");
        if (
          await transaction.billingContactChallenge.findUnique({
            where: {
              accountId_operationId: {
                accountId,
                operationId: command.operationId,
              },
            },
          })
        )
          return contactFailure("operation_conflict");
        const contact = await transaction.billingContact.findUnique({
          where: { accountId },
        });
        if (!contact?.verifiedAt) return contactFailure("contact_required");
        const selected: LegalDocument[] = [];
        for (const presented of command.documents) {
          const document = this.documents.find(
            (candidate) =>
              candidate.kind === presented.kind &&
              candidate.documentId === presented.documentId &&
              candidate.version === presented.version &&
              candidate.digest === presented.digest,
          );
          if (!document) return contactFailure("document_changed");
          selected.push(document);
        }
        const evidenceRefs: string[] = [];
        const instant = now();
        for (const document of selected) {
          const id = randomUUID();
          await transaction.billingConsentEvidence.create({
            data: {
              id,
              accountId,
              operationId: command.operationId,
              contextRef: command.contextRef,
              kind: document.kind,
              documentId: document.documentId,
              documentVersion: document.version,
              documentDigest: document.digest,
              documentText: document.text,
              documentUrl: document.url,
              acceptedAt: instant,
            },
          });
          evidenceRefs.push(id);
        }
        const result = { ok: true as const, evidenceRefs };
        await transaction.billingContactCommand.create({
          data: {
            accountId,
            operationId: command.operationId,
            fingerprint,
            result,
          },
        });
        return result;
      });
    } catch {
      return contactFailure("internal_error");
    }
  }
}
