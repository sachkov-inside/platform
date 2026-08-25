import type { PlatformDatabase } from "../../infrastructure/postgres/index.js";
import type { IdentityPrincipals } from "./application/identity-principals.interface.js";
import { createPostgresIdentityPrincipals } from "./infrastructure/postgres/postgres-identity-principals.js";

export function createIdentityPrincipals(dependencies: {
  readonly database: PlatformDatabase;
  readonly emailFingerprintKey: string;
}): IdentityPrincipals {
  return createPostgresIdentityPrincipals(dependencies);
}
