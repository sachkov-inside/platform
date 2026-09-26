import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  lockAccountRecords,
  type AccountsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  acceptTermsSchema,
  acceptanceScreenSchema,
  legalAcceptanceFailure,
  shownRenewalTermsSchema,
  termsDocumentSchema,
  type AcceptTermsResult,
  type AcceptedDocument,
  type ListAcceptedDocumentsResult,
  type ReadTermsStatusResult,
  type TermsAcceptanceCheck,
  type TermsDocument,
} from "./legal-acceptances.contract.js";

export interface LegalAcceptancesDependencies {
  readonly prisma: AccountsPrismaClient;
  /** The terms of use in force and the exact text a first sign-in accepts. */
  readonly terms: TermsDocument & { readonly text: string };
  readonly now: () => Date;
}

const termsKind = "terms";

/**
 * The journal of accepted legal documents. Rows are only appended: the table trigger refuses to
 * change or delete them. The terms of use are accepted once per edition by the button on the first
 * sign-in screen and need no verified contact; offers at payment are recorded by `BillingContact`
 * into the same journal.
 */
export class LegalAcceptances {
  private readonly terms: TermsDocument & { readonly text: string };

  constructor(private readonly dependencies: LegalAcceptancesDependencies) {
    const { text, ...document } = dependencies.terms;
    this.terms = {
      ...termsDocumentSchema.parse(document),
      text: z.string().min(1).parse(text),
    };
    if (
      createHash("sha256").update(this.terms.text).digest("hex") !==
      this.terms.digest
    )
      throw new Error("Terms of use digest mismatch");
  }

  async checkTerms(accountId: string): Promise<TermsAcceptanceCheck> {
    if (!z.uuid().safeParse(accountId).success)
      return legalAcceptanceFailure("forbidden");
    try {
      const accepted = await this.dependencies.prisma.legalAcceptance.findFirst(
        {
          where: this.currentTermsFilter(accountId),
          select: { id: true },
        },
      );
      return { ok: true, accepted: accepted !== null };
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "checkTerms" },
        error,
        legalAcceptanceFailure("internal_error"),
      );
    }
  }

  async readTermsStatus(accountId: string): Promise<ReadTermsStatusResult> {
    if (!z.uuid().safeParse(accountId).success)
      return legalAcceptanceFailure("forbidden");
    try {
      const rows = await this.dependencies.prisma.legalAcceptance.findMany({
        where: {
          accountId,
          kind: termsKind,
          documentId: this.terms.documentId,
        },
        select: { documentVersion: true, documentDigest: true },
      });
      const accepted = rows.some((row) => this.isCurrentTerms(row));
      return {
        ok: true,
        accepted,
        previouslyAccepted: !accepted && rows.length > 0,
        document: this.termsDocument(),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "readTermsStatus" },
        error,
        legalAcceptanceFailure("internal_error"),
      );
    }
  }

  async acceptTerms(
    accountId: string,
    input: unknown,
  ): Promise<AcceptTermsResult> {
    const parsed = acceptTermsSchema.safeParse(input);
    if (!parsed.success) return legalAcceptanceFailure("invalid_input");
    if (!z.uuid().safeParse(accountId).success)
      return legalAcceptanceFailure("forbidden");
    const command = parsed.data;
    const { prisma, now } = this.dependencies;
    try {
      return await prisma.$transaction(async (transaction) => {
        await lockAccountRecords(transaction, [
          `legal-acceptance:${accountId}`,
        ]);
        if (
          !(await transaction.account.findUnique({ where: { id: accountId } }))
        )
          return legalAcceptanceFailure("forbidden");
        const repeated = await transaction.legalAcceptance.findUnique({
          where: {
            accountId_operationId_kind: {
              accountId,
              operationId: command.operationId,
              kind: termsKind,
            },
          },
        });
        if (repeated)
          return repeated.documentId === this.terms.documentId &&
            repeated.documentVersion === command.version &&
            repeated.documentDigest === command.digest &&
            repeated.buttonLabel === command.buttonLabel
            ? { ok: true as const, acceptanceRef: repeated.id }
            : legalAcceptanceFailure("operation_conflict");
        if (
          command.version !== this.terms.version ||
          command.digest !== this.terms.digest
        )
          return legalAcceptanceFailure("document_changed");
        // Another tab already accepted this edition: the journal keeps one row per acceptance.
        const existing = await transaction.legalAcceptance.findFirst({
          where: this.currentTermsFilter(accountId),
          orderBy: { acceptedAt: "asc" },
        });
        if (existing) return { ok: true as const, acceptanceRef: existing.id };
        const id = randomUUID();
        await transaction.legalAcceptance.create({
          data: {
            id,
            accountId,
            operationId: command.operationId,
            kind: termsKind,
            documentId: this.terms.documentId,
            documentVersion: this.terms.version,
            documentDigest: this.terms.digest,
            documentText: this.terms.text,
            documentUrl: this.terms.url,
            screen: "first-sign-in",
            buttonLabel: command.buttonLabel,
            acceptedAt: now(),
          },
        });
        return { ok: true as const, acceptanceRef: id };
      });
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "acceptTerms" },
        error,
        legalAcceptanceFailure("internal_error"),
      );
    }
  }

  async listAccepted(accountId: string): Promise<ListAcceptedDocumentsResult> {
    if (!z.uuid().safeParse(accountId).success)
      return legalAcceptanceFailure("forbidden");
    try {
      const rows = await this.dependencies.prisma.legalAcceptance.findMany({
        where: { accountId },
        orderBy: [{ acceptedAt: "desc" }, { id: "asc" }],
      });
      return {
        ok: true,
        documents: rows.map((row): AcceptedDocument => ({
          acceptanceRef: row.id,
          documentId: row.documentId,
          version: row.documentVersion,
          url: row.documentUrl,
          acceptedAt: row.acceptedAt.toISOString(),
          screen: acceptanceScreenSchema
            .nullable()
            .catch(null)
            .parse(row.screen),
          buttonLabel: row.buttonLabel,
          shownTerms: shownRenewalTermsSchema
            .nullable()
            .catch(null)
            .parse(row.shownTerms),
        })),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "accounts", operation: "listAccepted" },
        error,
        legalAcceptanceFailure("internal_error"),
      );
    }
  }

  private termsDocument(): TermsDocument {
    const { text: _text, ...document } = this.terms;
    return document;
  }

  private currentTermsFilter(accountId: string) {
    return {
      accountId,
      kind: termsKind,
      documentId: this.terms.documentId,
      documentVersion: this.terms.version,
      documentDigest: this.terms.digest,
    };
  }

  private isCurrentTerms(row: {
    readonly documentVersion: string;
    readonly documentDigest: string;
  }): boolean {
    return (
      row.documentVersion === this.terms.version &&
      row.documentDigest === this.terms.digest
    );
  }
}
