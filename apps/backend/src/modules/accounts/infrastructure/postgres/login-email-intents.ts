import { z } from "zod";
import {
  Prisma,
  type AccountsPrisma,
} from "../../../../infrastructure/prisma/index.js";
import type { VerifiedAccountIdentity } from "../../facets/accounts/verified-logto-identity.js";
import type {
  LoginEmailIntent,
  LoginEmailState,
} from "../../features/login-email-identity/login-email-policy.js";

const recordSchema = z.strictObject({
  id: z.uuid(),
  account_id: z.uuid(),
  command_ref: z.uuid(),
  interaction_ref: z.string().min(1).max(128),
  browser_binding_digest: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum([
    "pending",
    "reserved",
    "finalized",
    "superseded",
    "reconciliation_required",
  ]),
  candidate_fingerprint: z
    .string()
    .regex(/^v1:[a-f0-9]{64}$/u)
    .nullable(),
  verification_ref: z.string().min(1).max(128).nullable(),
  expires_at: z.date(),
  logto_issuer: z.string(),
  logto_subject: z.string(),
  telegram_subject_ref: z.uuid(),
});
export type LoginEmailRecord = LoginEmailIntent & {
  readonly commandRef: string;
};

function parseRecord(rows: unknown): LoginEmailRecord | undefined {
  const row = z.array(recordSchema).max(1).parse(rows)[0];
  return row === undefined
    ? undefined
    : {
        intentRef: row.id,
        accountId: row.account_id,
        commandRef: row.command_ref,
        ownerIdentity: { issuer: row.logto_issuer, subject: row.logto_subject },
        interactionRef: row.interaction_ref,
        browserBindingDigest: row.browser_binding_digest,
        state: row.state,
        candidateFingerprint: row.candidate_fingerprint,
        verificationRef: row.verification_ref,
        telegramSubjectRef: row.telegram_subject_ref,
        expiresAt: row.expires_at,
      };
}

export async function readLoginEmailIntent(
  transaction: AccountsPrisma,
  intentRef: string,
  identity: VerifiedAccountIdentity,
): Promise<LoginEmailRecord | undefined> {
  return parseRecord(
    await transaction.$queryRaw(Prisma.sql`
    select i.id, i.account_id, i.command_ref, i.interaction_ref, i.browser_binding_digest,
      i.state, i.candidate_fingerprint, i.verification_ref, i.expires_at,
      a.logto_issuer, a.logto_subject, i.telegram_subject_ref
    from accounts.login_email_intents i join accounts.accounts a on a.id = i.account_id
    where i.id = ${intentRef}::uuid and a.logto_issuer = ${identity.issuer} and a.logto_subject = ${identity.subject}
  `),
  );
}

export async function findLoginEmailIntent(
  transaction: AccountsPrisma,
  accountId: string,
  commandRef?: string,
): Promise<
  { readonly intentRef: string; readonly state: LoginEmailState } | undefined
> {
  const rows = await transaction.$queryRaw(Prisma.sql`
    select id, state from accounts.login_email_intents
    where account_id = ${accountId}::uuid and (
      (${commandRef ?? null}::uuid is not null and command_ref = ${commandRef ?? null}::uuid)
      or (${commandRef ?? null}::uuid is null and state in ('pending', 'reserved', 'reconciliation_required'))
    )
  `);
  const row = z
    .array(z.strictObject({ id: z.uuid(), state: recordSchema.shape.state }))
    .max(1)
    .parse(rows)[0];
  return row === undefined
    ? undefined
    : { intentRef: row.id, state: row.state };
}

/** Read under the same email advisory lock as every Account identity writer. TTL is irrelevant. */
export async function isLoginEmailReserved(
  transaction: AccountsPrisma,
  fingerprint: string,
): Promise<boolean> {
  const rows = z
    .array(z.strictObject({ id: z.uuid() }))
    .max(1)
    .parse(
      await transaction.$queryRaw(Prisma.sql`
    select id from accounts.login_email_intents where candidate_fingerprint = ${fingerprint}
      and state in ('reserved', 'reconciliation_required')
  `),
    );
  return rows.length !== 0;
}

/** Conditional ledger transitions and partial unique reservations are PostgreSQL-owned. */
export async function createLoginEmailIntent(
  transaction: AccountsPrisma,
  intent: LoginEmailRecord,
  now: Date,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    insert into accounts.login_email_intents (id, account_id, telegram_subject_ref, command_ref, interaction_ref,
      browser_binding_digest, state, expires_at, created_at, updated_at)
    values (${intent.intentRef}::uuid, ${intent.accountId}::uuid, ${intent.telegramSubjectRef}::uuid, ${intent.commandRef}::uuid,
      ${intent.interactionRef}, ${intent.browserBindingDigest}, 'pending', ${intent.expiresAt}, ${now}, ${now})
  `);
}

export async function selectLoginEmailCandidate(
  transaction: AccountsPrisma,
  intentRef: string,
  fingerprint: string,
  verificationRef: string,
  now: Date,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    update accounts.login_email_intents set candidate_fingerprint = ${fingerprint}, verification_ref = ${verificationRef}, updated_at = ${now}
    where id = ${intentRef}::uuid and state = 'pending' and candidate_fingerprint is null
  `);
}

export async function reserveLoginEmailIntent(
  transaction: AccountsPrisma,
  intentRef: string,
  proof: { readonly requestRef: string; readonly approvedAt: string },
  now: Date,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    update accounts.login_email_intents set state = 'reserved', reserved_at = ${now},
      telegram_request_ref = ${proof.requestRef}::uuid, telegram_approved_at = ${new Date(proof.approvedAt)}, updated_at = ${now}
    where id = ${intentRef}::uuid and state = 'pending'
  `);
}

export async function changeLoginEmailState(
  transaction: AccountsPrisma,
  intentRef: string,
  state: "superseded" | "finalized" | "reconciliation_required",
  now: Date,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    update accounts.login_email_intents set state = ${state}, updated_at = ${now}
    where id = ${intentRef}::uuid and state in ('pending', 'reserved', 'reconciliation_required')
  `);
}

export async function isLoginEmailInteractionUsed(
  transaction: AccountsPrisma,
  interactionRef: string,
): Promise<boolean> {
  const rows = z
    .array(z.strictObject({ id: z.uuid() }))
    .max(1)
    .parse(
      await transaction.$queryRaw(Prisma.sql`
    select id from accounts.login_email_intents where interaction_ref = ${interactionRef}
  `),
    );
  return rows.length !== 0;
}
