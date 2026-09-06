import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  PLATFORM_CONFIG,
  parsePlatformConfig,
} from "../../src/config/platform-config.js";
import {
  LOGTO_ACCESS_TOKEN_VERIFIER,
  accountProblemSchema,
} from "../../src/modules/accounts/index.js";
import { TelegramAccountSignInController } from "../../src/modules/telegram-membership/features/complete-telegram-sign-in/telegram-account-sign-in.controller.js";
import { TelegramAccountSignIn } from "../../src/modules/telegram-membership/features/complete-telegram-sign-in/telegram-account-sign-in.js";

@Module({
  controllers: [TelegramAccountSignInController],
  providers: [
    {
      provide: PLATFORM_CONFIG,
      useValue: parsePlatformConfig({ NODE_ENV: "test" }),
    },
    { provide: TelegramAccountSignIn, useValue: {} },
    {
      provide: LOGTO_ACCESS_TOKEN_VERIFIER,
      useValue: {
        verifyAccountSignIn: () =>
          Promise.resolve({ ok: false, error: { code: "invalid_proof" } }),
      },
    },
  ],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest metadata owns this HTTP fixture module.
class Fixture {}
let app: NestFastifyApplication;
beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(
    Fixture,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => app.close());

test.each(["complete", "linked-identity"])(
  "%s rejects missing authentication with the documented problem body",
  async (endpoint) => {
    const response = await app.inject({
      method: "POST",
      url: `/integrations/telegram/v1/sign-in/${endpoint}`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(accountProblemSchema.strict().parse(response.json())).toMatchObject({
      status: 401,
      code: "invalid_proof",
    });
  },
);
