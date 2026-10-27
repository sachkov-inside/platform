import { randomBytes, randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { parsePlatformConfig } from "../../../src/config/platform-config.js";
import { createApiApplication } from "../../../src/entrypoints/api/create-api-application.js";
import {
  assembleAccounts,
  type PlatformPermission,
} from "../../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { fingerprintEmail } from "../../../src/modules/accounts/shared/account-input.js";
import { assembleAccessGrants } from "../../../src/modules/account-rights/index.js";
import { CoverageCatalog } from "../../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { ProductDiscovery } from "../../../src/modules/products/index.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../../support/declared-api.js";
import {
  startTelegramContactsDouble,
  type TelegramDoubleProfile,
} from "../../support/telegram-contacts-double.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./test-identity-issuer.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./test-database.js";

const issuer = "https://identity.people-api.test/oidc";
const linkingSecret = "people-api-linking-secret";
export const peopleFingerprintKey = "people-api-email-fingerprint-key-0001";

/**
 * The API process over its own database with a Telegram contacts double, for the people list,
 * the person card and the people search group (#1721). Actors are Accounts without a Sign-in
 * Email, so an actor is never one of the people a test counts.
 */
export async function startPeopleApi(): Promise<PeopleApi> {
  const database = await createMigratedTestDatabase();
  const identity = await startTestIdentityIssuer({
    issuer,
    audience: "https://api.people-api.test",
  });
  const telegram = await startTelegramContactsDouble(linkingSecret);
  const encryptionKey = randomBytes(32).toString("base64");
  const app = await createApiApplication(
    parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      LOGTO_ISSUER: identity.issuer,
      LOGTO_AUDIENCE: identity.audience,
      LOGTO_JWKS_URL: identity.jwksUrl,
      IDENTITY_EMAIL_FINGERPRINT_KEY: peopleFingerprintKey,
      BILLING_CONTACT_ENCRYPTION_KEY: encryptionKey,
      BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
      BILLING_CONTACT_SMTP_PORT: "2525",
      BILLING_CONTACT_FROM: "noreply@example.test",
      TELEGRAM_LINKING_ENDPOINT: telegram.linkingEndpoint,
      TELEGRAM_LINKING_SECRET: linkingSecret,
    }),
    { logger: false },
  );
  await app.init();
  const server = declaredServer(app.getHttpAdapter().getInstance());
  await server.ready();
  const protection = billingContactProtection(encryptionKey);
  const grants = assembleAccessGrants({
    prisma: database.prisma,
    accounts: assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: peopleFingerprintKey,
    }),
    contentCatalog: new CoverageCatalog(
      database.prisma,
      new ProductDiscovery(database.prisma),
    ),
  });

  return {
    database,
    identity,
    telegram,
    app,
    server,
    grants,
    async signedIn(permission) {
      const subject = `people-actor-${randomUUID()}`;
      const id = randomUUID();
      await database.prisma.account.create({
        data: { id, logtoIssuer: issuer, logtoSubject: subject },
      });
      if (permission !== null)
        await database.prisma.accountPermission.create({
          data: { accountId: id, permission },
        });
      return {
        accountId: id,
        headers: {
          authorization: `Bearer ${await identity.sign(subject)}`,
        },
      };
    },
    async person(input) {
      const id = input.id ?? randomUUID();
      await database.prisma.account.create({
        data: {
          id,
          logtoIssuer: issuer,
          logtoSubject: `person-${id}`,
          emailFingerprint:
            input.signInEmail === undefined
              ? null
              : (fingerprintEmail(input.signInEmail, peopleFingerprintKey) ??
                null),
          ...(input.registeredAt === undefined
            ? {}
            : { createdAt: new Date(input.registeredAt) }),
        },
      });
      if (input.billingEmail !== undefined) {
        const revision = input.billingRevision ?? 1;
        await database.prisma.billingContact.create({
          data: {
            accountId: id,
            revision,
            emailCiphertext: protection.seal(id, input.billingEmail),
            verifiedAt: new Date("2030-01-01T00:00:00.000Z"),
            emailFingerprint:
              fingerprintEmail(input.billingEmail, peopleFingerprintKey) ??
              null,
            emailFingerprintRevision: input.fingerprintRevision ?? revision,
          },
        });
      }
      if (input.unverifiedContact === true)
        await database.prisma.billingContact.create({
          data: { accountId: id, revision: 0 },
        });
      if (input.telegram !== undefined) {
        const accountRef = `principal:${id}`;
        const telegramIdentityRef = `identity:${id}`;
        await database.prisma.telegramAccountLinkState.create({
          data: {
            accountId: id,
            linkRef: randomUUID(),
            revision: 1,
            principalRef: accountRef,
            identityRef: telegramIdentityRef,
            updatedAt: new Date("2030-01-01T00:00:00.000Z"),
          },
        });
        if (input.telegram !== "unknown")
          telegram.profiles.set(telegramIdentityRef, {
            accountRef,
            telegramIdentityRef,
            ...input.telegram,
          });
      }
      return id;
    },
    async close() {
      await app.close();
      await identity.close();
      await telegram.close();
      await database.dispose();
    },
  };
}

export interface PeopleApi {
  readonly database: TestDatabase;
  readonly identity: TestIdentityIssuer;
  readonly telegram: Awaited<ReturnType<typeof startTelegramContactsDouble>>;
  readonly app: NestFastifyApplication;
  readonly server: DeclaredServer;
  /** Product Access over the same database, for fixtures. */
  readonly grants: ReturnType<typeof assembleAccessGrants>;
  /** An actor with one permission (or none) who is no person. */
  signedIn(permission: PlatformPermission | null): Promise<{
    readonly accountId: string;
    readonly headers: Record<string, string>;
  }>;
  /**
   * A person or a visitor: a Sign-in Email fingerprint, a verified Billing Contact with its own
   * fingerprint (`fingerprintRevision` below `billingRevision` is stale), an unverified contact,
   * and a current Telegram link whose profile the double knows (`unknown`: the double does not).
   */
  person(input: {
    readonly id?: string;
    readonly registeredAt?: string;
    readonly signInEmail?: string;
    readonly billingEmail?: string;
    readonly billingRevision?: number;
    readonly fingerprintRevision?: number;
    readonly unverifiedContact?: boolean;
    readonly telegram?:
      | Pick<TelegramDoubleProfile, "displayName" | "username" | "marketing">
      | "unknown";
  }): Promise<string>;
  close(): Promise<void>;
}
