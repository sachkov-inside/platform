import { z } from "zod";

export const loginEmailIdentityContractVersion =
  "inside.login-email-identity.v1";

export const beginLoginEmailIdentitySchema = z.strictObject({
  commandRef: z.uuidv4(),
});

const ownerIdentitySchema = z.strictObject({
  issuer: z.url().regex(/^https:\/\//u),
  subject: z.string().min(1).max(500),
});
const candidateFields = {
  contractVersion: z.literal(loginEmailIdentityContractVersion),
  intentRef: z.uuidv4(),
  ownerIdentity: ownerIdentitySchema,
  email: z.email().max(320),
  verificationRef: z.string().min(1).max(128),
};

/** Server-to-server only; these identity fields never come from the public begin body. */
export const selectLoginEmailCandidateSchema = z.strictObject(candidateFields);

/** Codes remain in Logto. This carries its record reference and fresh Telegram receipt. */
export const reserveLoginEmailIdentitySchema = z.strictObject({
  ...candidateFields,
  telegramProof: z.strictObject({
    subjectRef: z.uuidv4(),
    requestRef: z.uuidv4(),
    approvedAt: z.iso.datetime(),
  }),
});

/** Only a committed provider receipt can finalize; absence of a response is not failure proof. */
export const finalizeLoginEmailIdentitySchema = z.strictObject({
  contractVersion: z.literal(loginEmailIdentityContractVersion),
  intentRef: z.uuidv4(),
  ownerIdentity: ownerIdentitySchema,
  receipt: z.strictObject({
    intentRef: z.uuidv4(),
    state: z.literal("attached"),
    email: z.email().max(320),
  }),
});

export const loginEmailIdentityResultSchema = z.union([
  z.strictObject({
    contractVersion: z.literal(loginEmailIdentityContractVersion),
    intentRef: z.uuidv4(),
    status: z.enum([
      "pending",
      "reserved",
      "finalized",
      "superseded",
      "reconciliation_required",
    ]),
    expiresAt: z.iso.datetime(),
  }),
  z.strictObject({
    contractVersion: z.literal(loginEmailIdentityContractVersion),
    status: z.enum(["unavailable", "identity_conflict", "expired"]),
  }),
]);
