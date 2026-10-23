import type { CoverageCatalog } from "../../ports/coverage-catalog.js";
import { randomUUID } from "node:crypto";
import {
  lockAccountAccess,
  lockAccountEntitlementChanges,
} from "../../../../infrastructure/prisma/index.js";
import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { Accounts } from "../../../accounts/index.js";
import type { AccountRightsPrisma } from "../../infrastructure/prisma.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  issueProductAccessSchema,
  productAccessContextSchema,
  productAccessViewSchema,
} from "../../domain/product-access.js";

/** Called only by confirmed Billing, verified Course Activation and explicit owner issuance. */
export async function issueProductAccess(
  tx: AccountRightsPrisma,
  accounts: Pick<Accounts, "checkPermission" | "readIdentityForLink">,
  contextInput: unknown,
  input: unknown,
  now: Date,
  catalog?: Pick<CoverageCatalog, "hasProduct">,
) {
  const context = productAccessContextSchema.safeParse(contextInput),
    parsed = issueProductAccessSchema.safeParse(input);
  if (!context.success || !parsed.success)
    return accessFailure("invalid_input");
  const command = parsed.data;
  if (context.data.source !== "manual" && new Date(command.issuedAt) > now)
    return accessFailure("invalid_input");
  if (context.data.source === "manual") {
    if (context.data.actorId === undefined) return accessFailure("forbidden");
    const decision = await accounts.checkPermission(
      { accountId: context.data.actorId, permission: "billing:manage" },
      transactionHandle(tx),
    );
    if (!decision.ok) return accessFailure("unavailable");
    if (!decision.allowed) return accessFailure("forbidden");
    if (catalog?.hasProduct === undefined) return accessFailure("unavailable");
    if (!(await catalog.hasProduct(command.productId, transactionHandle(tx))))
      return accessFailure("not_found");
  }
  if (
    (await accounts.readIdentityForLink(
      command.accountId,
      transactionHandle(tx),
    )) === undefined
  )
    return accessFailure("not_found");
  await lockAccountEntitlementChanges(tx, command.accountId);
  await lockAccountAccess(
    tx,
    `product-source:${context.data.source}:${command.sourceRef}`,
  );
  const existingSource = await tx.productAccessSource.findUnique({
    where: {
      source_sourceRef: {
        source: context.data.source,
        sourceRef: command.sourceRef,
      },
    },
  });
  if (context.data.source === "manual")
    command.issuedAt =
      existingSource?.issuedAt.toISOString() ?? now.toISOString();
  if (
    existingSource !== null &&
    (existingSource.accountId !== command.accountId.toLowerCase() ||
      existingSource.productId !== command.productId.toLowerCase() ||
      existingSource.issuedAt.toISOString() !== command.issuedAt ||
      existingSource.reason !== command.reason)
  )
    return accessFailure("operation_conflict");
  const key = { accountId: command.accountId, productId: command.productId };
  let row = await tx.productAccess.findUnique({
    where: { accountId_productId: key },
  });
  const issued = row === null;
  if (row === null) {
    row = await tx.productAccess.create({
      data: { ...key, firstIssuedAt: new Date(command.issuedAt), revision: 1 },
    });
  }
  if (existingSource === null) {
    await tx.productAccessSource.create({
      data: {
        ...key,
        source: context.data.source,
        sourceRef: command.sourceRef,
        issuedAt: new Date(command.issuedAt),
        reason: command.reason,
      },
    });
    await tx.productAccessAction.create({
      data: {
        id: randomUUID(),
        ...key,
        actorId: context.data.actorId ?? null,
        kind: issued ? "issue" : "source_recorded",
        reason: command.reason,
        recordedAt: now,
        revision: row.revision,
      },
    });
  }
  if (issued)
    await tx.accessChange.create({
      data: {
        accountId: command.accountId,
        actorId: context.data.actorId ?? null,
        operationId: randomUUID(),
        kind: "product_issue",
        reason: command.reason,
        recordedAt: now,
      },
    });
  return {
    ok: true as const,
    outcome:
      row.revokedAt !== null
        ? ("revoked" as const)
        : issued
          ? ("issued" as const)
          : ("already_active" as const),
    value: productAccessViewSchema.parse({
      ...key,
      firstIssuedAt: row.firstIssuedAt.toISOString(),
      access: row.revokedAt === null ? "active" : "revoked",
      revision: row.revision,
    }),
  };
}
