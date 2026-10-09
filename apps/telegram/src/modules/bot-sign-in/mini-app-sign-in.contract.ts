import { z } from "zod";

export const miniAppSignInContractVersion = "inside.mini-app-sign-in.v1";
const browserDigestSchema = z.base64url().length(43);

export const miniAppRegistrationSchema = z.strictObject({
  contractVersion: z.literal(miniAppSignInContractVersion),
  requestRef: z.uuidv4(),
  startTokenDigest: browserDigestSchema,
  browserSecretDigest: browserDigestSchema,
  oidcContextDigest: browserDigestSchema,
  expiresAt: z.iso.datetime(),
});

export const miniAppApprovalSchema = z.strictObject({
  contractVersion: z.literal(miniAppSignInContractVersion),
  browserSecret: browserDigestSchema,
  initData: z.string().min(1).max(16_384),
});

export const miniAppBindingSchema = z.strictObject({
  contractVersion: z.literal(miniAppSignInContractVersion),
  oidcContextDigest: browserDigestSchema,
  browserSecretDigest: browserDigestSchema,
});
