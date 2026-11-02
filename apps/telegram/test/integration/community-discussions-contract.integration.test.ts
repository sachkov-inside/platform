import scenarios from "@inside/contracts/inside-community-discussions-v1/scenarios.json" with { type: "json" };
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DATABASE } from "../../src/database/database.js";
import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import {
  APPLICATION_CONFIG,
  loadApplicationConfig,
} from "../../src/config/application-config.js";
import { CLOCK } from "../../src/shared/clock.js";
import { AUTHOR_AUTHORIZATION } from "../../src/modules/communications/author-authorization.js";
import { CommunityDiscussions } from "../../src/modules/community-discussions/community-discussions.js";
import { CommunityDiscussionsController } from "../../src/modules/community-discussions/community-discussions.controller.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { required } from "../support/required.js";

registerFixedClock();
const database = createDatabase(required(process.env["DATABASE_URL"]));
const secret = "synthetic_discussions_contract_secret";
let app: NestFastifyApplication | undefined;
let authorization = "allowed";
beforeAll(async () => {
  await migrateToLatest(database);
  const config = loadApplicationConfig({
    DATABASE_URL: required(process.env["DATABASE_URL"]),
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests",
    PLATFORM_COMMUNITY_DISCUSSIONS_SECRET: secret,
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic non member",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
  });
  const module = await Test.createTestingModule({
    controllers: [CommunityDiscussionsController],
    providers: [
      CommunityDiscussions,
      { provide: DATABASE, useValue: database },
      { provide: APPLICATION_CONFIG, useValue: config },
      { provide: CLOCK, useValue: { now: () => new Date(fixedTestInstant()) } },
      {
        provide: AUTHOR_AUTHORIZATION,
        useValue: { authorize: () => Promise.resolve(authorization) },
      },
    ],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await database.destroy();
  }
});

for (const scenario of scenarios)
  it(`shared discussion HTTP scenario: ${scenario.name}`, async () => {
    authorization = scenario.authorization;
    const credential =
      scenario.credential === "valid"
        ? secret
        : scenario.credential === "wrong"
          ? "wrong-credential"
          : undefined;
    const response = await required(app).inject({
      method: "POST",
      url: "/integrations/platform/v1/community-discussions",
      headers:
        credential === undefined
          ? {}
          : { authorization: `Bearer ${credential}` },
      payload: scenario.request,
    });
    expect(response.statusCode).toBe(scenario.status);
    expect(response.json()).toEqual(scenario.response);
  });
