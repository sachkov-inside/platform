import { registerFixedClock } from "../support/fixed-clock.js";

import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { AccountDirectory } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { fingerprintEmail } from "../../src/modules/accounts/shared/account-input.js";
import { PeopleDirectory } from "../../src/modules/people-directory/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";
import { unreadPeopleOwners } from "./setup/people-owners.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const encryptionKey = randomBytes(32).toString("base64");
const linkingSecret = "people-directory-linking-secret";
const fingerprintKey = "people-directory-email-fingerprint";
const contactsRequestSchema = z.object({
  contacts: z.array(
    z.object({ accountRef: z.string(), telegramIdentityRef: z.string() }),
  ),
});

/** Every personal fact the fixtures carry: none of them may reach a refused answer. */
const personalFacts = [
  "learner.sign-in@example.test",
  "billing.person@example.test",
  "Анна Телеграмова",
  "anna_tg",
];

/**
 * The owner's people directory (#1721) over HTTP: who counts as a person, exact email search, the
 * identities join for other lists, and refusal of every other role without personal data.
 */
describe("People directory", () => {
  let database: TestDatabase;
  let identity: TestIdentityIssuer;
  let telegram: Server;
  let app: NestFastifyApplication;
  let server: DeclaredServer;
  let telegramAvailable = true;
  const people = {
    signIn: "",
    billing: randomUUID(),
    telegram: randomUUID(),
    unverified: randomUUID(),
    visitor: randomUUID(),
  };

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    identity = await startTestIdentityIssuer({
      issuer: "https://identity.people.test/oidc",
      audience: "https://api.people.test",
    });
    // Telegram answers the v1 contact read for the linked person only.
    telegram = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        // A Telegram release before `inside.telegram-contact.v2` answers 404 on its paths.
        if (request.url?.startsWith("/integrations/platform/v2/") === true)
          return void response.writeHead(404).end();
        if (
          !telegramAvailable ||
          request.url !== "/integrations/platform/v1/telegram-contacts" ||
          request.headers.authorization !== `Bearer ${linkingSecret}`
        )
          return void response.writeHead(503).end();
        const parsed = contactsRequestSchema.parse(JSON.parse(body));
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            contractVersion: "inside.telegram-contact.v1",
            contacts: parsed.contacts.map((contact) => ({
              ...contact,
              status: "available",
              displayName: "Анна Телеграмова",
              username: "anna_tg",
            })),
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      telegram.listen(0, "127.0.0.1", resolve),
    );
    const address = telegram.address();
    if (address === null || typeof address === "string")
      throw new Error("Telegram double has no TCP port");
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: identity.issuer,
        LOGTO_AUDIENCE: identity.audience,
        LOGTO_JWKS_URL: identity.jwksUrl,
        IDENTITY_EMAIL_FINGERPRINT_KEY: fingerprintKey,
        BILLING_CONTACT_ENCRYPTION_KEY: encryptionKey,
        BILLING_CONTACT_SMTP_HOST: "127.0.0.1",
        BILLING_CONTACT_SMTP_PORT: "2525",
        BILLING_CONTACT_FROM: "noreply@example.test",
        TELEGRAM_LINKING_ENDPOINT: `http://127.0.0.1:${String(address.port)}/integrations/platform/v1/identity-links`,
        TELEGRAM_LINKING_SECRET: linkingSecret,
      }),
      { logger: false },
    );
    await app.init();
    server = declaredServer(app.getHttpAdapter().getInstance());
    await server.ready();

    people.signIn = await signedInAccount(
      `people-sign-in-${randomUUID()}`,
      "Learner.Sign-In@Example.test",
    );
    await database.prisma.account.createMany({
      data: [
        people.billing,
        people.telegram,
        people.unverified,
        people.visitor,
      ].map((id) => ({
        id,
        logtoIssuer: "https://identity.people.test/oidc",
        logtoSubject: `fixture-${id}`,
      })),
    });
    await database.prisma.billingContact.createMany({
      data: [
        {
          accountId: people.billing,
          revision: 1,
          emailCiphertext: billingContactProtection(encryptionKey).seal(
            people.billing,
            "billing.person@example.test",
          ),
          verifiedAt: new Date("2030-01-01T00:00:00.000Z"),
          emailFingerprint:
            fingerprintEmail("billing.person@example.test", fingerprintKey) ??
            null,
          emailFingerprintRevision: 1,
        },
        // A started confirmation is no contact: this Account stays a visitor.
        { accountId: people.unverified, revision: 0 },
      ],
    });
    await database.prisma.telegramAccountLinkState.create({
      data: {
        accountId: people.telegram,
        linkRef: randomUUID(),
        revision: 1,
        principalRef: `principal:${people.telegram}`,
        identityRef: `identity:${people.telegram}`,
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await identity.close();
    await new Promise<void>((resolve, reject) =>
      telegram.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
    await database.dispose();
  });

  test("the owner reads identities of people in the requested order and never of a visitor", async () => {
    const headers = await signedIn("billing:manage");
    const response = await server.inject({
      method: "GET",
      url: `/authoring/people/identities?accountIds=${[
        people.visitor,
        people.telegram,
        people.billing.toUpperCase(),
        people.unverified,
        people.signIn,
      ].join(",")}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({
      items: [
        {
          accountId: people.telegram,
          displayName: "Анна Телеграмова",
          username: "anna_tg",
          email: null,
          contactsState: "complete",
        },
        {
          accountId: people.billing,
          displayName: null,
          username: null,
          email: "billing.person@example.test",
          contactsState: "complete",
        },
        // The sign-in address itself is never shown: the server cannot read the sign-in provider.
        {
          accountId: people.signIn,
          displayName: null,
          username: null,
          email: null,
          contactsState: "complete",
        },
      ],
    });
  });

  test("names stay unknown, not invented or absent, when Telegram cannot answer", async () => {
    const headers = await signedIn("billing:manage");
    telegramAvailable = false;
    try {
      const response = await server.inject({
        method: "GET",
        url: `/authoring/people/identities?accountIds=${people.telegram}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            accountId: people.telegram,
            displayName: null,
            username: null,
            email: null,
            contactsState: "partial",
          },
        ],
      });
    } finally {
      telegramAvailable = true;
    }
  });

  test("search by Account ID finds a person and never a visitor or an unverified contact", async () => {
    const headers = await signedIn("billing:manage");
    expect(await search(headers, people.billing.toUpperCase())).toEqual({
      items: [
        {
          accountId: people.billing,
          displayName: null,
          username: null,
          email: "billing.person@example.test",
          contactsState: "complete",
        },
      ],
      nameSearch: "available",
    });
    for (const id of [people.visitor, people.unverified, randomUUID()])
      expect(await search(headers, id)).toEqual({
        items: [],
        nameSearch: "available",
      });
  });

  test("search by email matches the whole normalized address only", async () => {
    const headers = await signedIn("billing:manage");
    expect(await search(headers, "  LEARNER.sign-in@example.TEST ")).toEqual({
      items: [
        {
          accountId: people.signIn,
          displayName: null,
          username: null,
          email: null,
          contactsState: "complete",
        },
      ],
      nameSearch: "available",
    });
    // A verified Billing Contact is found by its own fingerprint, exactly as typed or not.
    expect(await search(headers, "Billing.Person@example.test")).toEqual({
      items: [
        {
          accountId: people.billing,
          displayName: null,
          username: null,
          email: "billing.person@example.test",
          contactsState: "complete",
        },
      ],
      nameSearch: "available",
    });
    expect(await search(headers, "other.sign-in@example.test")).toEqual({
      items: [],
      nameSearch: "available",
    });
    // A part of an address is name text, and name search needs Telegram's search contract.
    expect(await search(headers, "learner.sign-in@exam")).toEqual({
      items: [],
      nameSearch: "unavailable",
    });
  });

  test("a name or @username reports that name search is unavailable instead of an empty answer when Telegram predates its search", async () => {
    const headers = await signedIn("billing:manage");
    for (const query of ["Анна", "@anna_tg"])
      expect(await search(headers, query)).toEqual({
        items: [],
        nameSearch: "unavailable",
      });
  });

  test("the Account IDs for another owner's search report name search the same way", async () => {
    const owner = randomUUID();
    const directory = new PeopleDirectory({
      ...unreadPeopleOwners,
      accounts: {
        checkPermission: ({ accountId }) =>
          Promise.resolve({ ok: true, allowed: accountId === owner }),
      },
      directory: new AccountDirectory({
        prisma: database.prisma,
        protection: undefined,
        emailFingerprintKey: "people-directory-email-fingerprint",
      }),
      telegram: new TelegramAccountLinks(database.prisma),
    });
    expect(
      await directory.searchPersonAccounts(owner, {
        query: "LEARNER.sign-in@example.test",
      }),
    ).toEqual({
      ok: true,
      value: { accountIds: [people.signIn], nameSearch: "available" },
    });
    for (const query of ["Анна", "@anna_tg"])
      expect(await directory.searchPersonAccounts(owner, { query })).toEqual({
        ok: true,
        value: { accountIds: [], nameSearch: "unavailable" },
      });
    expect(
      await directory.searchPersonAccounts(randomUUID(), { query: "Анна" }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
  });

  test("other roles are refused without a personal fact, and malformed requests are rejected", async () => {
    const urls = [
      `/authoring/people/identities?accountIds=${people.billing},${people.telegram}`,
      `/authoring/people/search?query=${encodeURIComponent("billing.person@example.test")}`,
      `/authoring/people/search?query=${people.billing}`,
      // The right is checked before the input: a malformed request is refused too.
      "/authoring/people/search?query=%20",
      "/authoring/people/identities?accountIds=not-an-id",
    ];
    // `platform:admin` holds every permission (`checkPermission`), so it is no other role here.
    for (const permission of [
      "materials:manage",
      "communications:manage",
      null,
    ] as const) {
      const headers = await signedIn(permission);
      for (const url of urls) {
        const refused = await server.inject({ method: "GET", url, headers });
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toMatchObject({ code: "forbidden" });
        for (const fact of personalFacts)
          expect(refused.body).not.toContain(fact);
      }
    }
    for (const url of urls)
      expect((await server.inject({ method: "GET", url })).statusCode).toBe(
        401,
      );
    const owner = await signedIn("billing:manage");
    for (const url of [
      "/authoring/people/search?query=%20",
      `/authoring/people/search?query=${"a".repeat(161)}`,
      "/authoring/people/search?query=x&limit=21",
      "/authoring/people/identities?accountIds=not-an-id",
      `/authoring/people/identities?accountIds=${Array.from({ length: 101 }, () => randomUUID()).join(",")}`,
    ]) {
      const rejected = await server.inject({
        method: "GET",
        url,
        headers: owner,
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toMatchObject({ code: "invalid_request" });
    }
  });

  test("platform:admin holds every permission and reads people", async () => {
    const headers = await signedIn("platform:admin");
    expect(await search(headers, people.billing)).toMatchObject({
      items: [{ accountId: people.billing }],
    });
  });

  test("a verified Billing Contact that cannot be opened keeps the person, with the address unknown", async () => {
    const directory = new PeopleDirectory({
      ...unreadPeopleOwners,
      accounts: {
        checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
      },
      directory: new AccountDirectory({
        prisma: database.prisma,
        protection: undefined,
        emailFingerprintKey: fingerprintKey,
      }),
      telegram: new TelegramAccountLinks(database.prisma),
    });
    expect(
      await directory.readIdentities(randomUUID(), [people.billing]),
    ).toEqual({
      ok: true,
      value: [
        {
          accountId: people.billing,
          displayName: null,
          username: null,
          email: null,
          contactsState: "partial",
        },
      ],
    });
  });

  async function search(
    headers: Record<string, string>,
    query: string,
  ): Promise<unknown> {
    const response = await server.inject({
      method: "GET",
      url: `/authoring/people/search?query=${encodeURIComponent(query)}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return response.json();
  }

  async function signedInAccount(
    subject: string,
    email: string,
  ): Promise<string> {
    const bearer = await identity.sign(subject, {
      inside_verified_email: email,
    });
    const created = await server.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(created.statusCode).toBe(201);
    return (
      await database.prisma.account.findFirstOrThrow({
        where: { logtoSubject: subject },
      })
    ).id;
  }

  async function signedIn(
    permission:
      | "materials:manage"
      | "communications:manage"
      | "billing:manage"
      | "platform:admin"
      | null,
  ): Promise<Record<string, string>> {
    const subject = `people-actor-${randomUUID()}`;
    const bearer = await identity.sign(subject, {
      inside_verified_email: `${subject}@example.test`,
    });
    const headers = { authorization: `Bearer ${bearer}` };
    const created = await server.inject({
      method: "POST",
      url: "/accounts",
      headers,
    });
    expect(created.statusCode).toBe(201);
    if (permission !== null) {
      const account = await database.prisma.account.findFirstOrThrow({
        where: { logtoSubject: subject },
      });
      await database.prisma.accountPermission.create({
        data: { accountId: account.id, permission },
      });
    }
    return headers;
  }
});
