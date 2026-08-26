import { randomUUID } from "node:crypto";

import type { IdentityPrincipalsPrisma } from "../../../../infrastructure/prisma/index.js";
import type {
  PlatformSessionId,
  PrincipalId,
} from "../../domain/identity-identifiers.js";

export async function appendIdentityAuditEvent(
  prisma: IdentityPrincipalsPrisma,
  operation: string,
  outcome: string,
  references: {
    readonly principalId?: PrincipalId;
    readonly sessionId?: PlatformSessionId;
  },
): Promise<void> {
  await prisma.identityAuditEvent.create({
    data: {
      id: randomUUID(),
      operation,
      outcome,
      principalId: references.principalId ?? null,
      sessionId: references.sessionId ?? null,
    },
  });
}
