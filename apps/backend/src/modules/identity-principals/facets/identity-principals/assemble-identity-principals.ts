import type { IdentityPrincipalsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { beginHumanReauthentication } from "../../features/begin-human-reauthentication/begin-human-reauthentication.js";
import { checkPermission } from "../../features/check-permission/check-permission.js";
import { completeHumanReauthentication } from "../../features/complete-human-reauthentication/complete-human-reauthentication.js";
import { endSession } from "../../features/end-session/end-session.js";
import {
  establishHumanSession,
  establishServiceSession,
} from "../../features/establish-session/establish-session.js";
import { resolveSubject } from "../../features/resolve-subject/resolve-subject.js";
import type { IdentityPrincipals } from "./identity-principals.interface.js";

interface Dependencies {
  readonly prisma: IdentityPrincipalsPrismaClient;
  readonly emailFingerprintKey: string;
}

export function assembleIdentityPrincipals({
  prisma,
  emailFingerprintKey,
}: Dependencies): IdentityPrincipals {
  if (emailFingerprintKey.length < 16) {
    throw new TypeError("emailFingerprintKey must contain at least 16 characters");
  }

  const identityPrincipals: IdentityPrincipals = {
    establishHumanSession: (command) =>
      establishHumanSession(prisma, emailFingerprintKey, command),
    establishServiceSession: (command) => establishServiceSession(prisma, command),
    resolveSubject: (query) => resolveSubject(prisma, query),
    beginHumanReauthentication: (command) =>
      beginHumanReauthentication(prisma, command),
    completeHumanReauthentication: (command) =>
      completeHumanReauthentication(prisma, command),
    endSession: (command) => endSession(prisma, command),
    checkPermission: (query) => checkPermission(prisma, query),
  };
  return Object.freeze(identityPrincipals);
}
