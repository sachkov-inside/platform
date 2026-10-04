import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  parsePlatformConfig,
  type PlatformConfig,
} from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { acceptCurrentTerms } from "../support/accept-terms.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";
import {
  createScopedGuidesWorld,
  type ScopedGuide,
  type ScopedGuidesWorld,
} from "./setup/scoped-guides.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

/** Защищённые чтения, которые матрица проверок доступа называет поверхностями Guide. */
const surfaces = ["body", "assets", "video", "practice-list"] as const;
type Surface = (typeof surfaces)[number];
type Exposure = Readonly<Record<Surface, "open" | "closed">>;
const allOpen: Exposure = {
  body: "open",
  assets: "open",
  video: "open",
  "practice-list": "open",
};
const allClosed: Exposure = {
  body: "closed",
  assets: "closed",
  video: "closed",
  "practice-list": "closed",
};

/**
 * Scoped Account через настоящий Nest HTTP (#903, пробел 7 из #902): API поднят целиком, Account
 * входит подписанным токеном, право — настоящий AccessGrant одного Guide. Тело и список заданий
 * открыты, когда ответ несёт секрет Guide. Файл открыт, когда ответ — подписанная ссылка на его
 * объект; видео — когда выдан DRM-токен воспроизведения. Bytes файла и видео лежат у хранилища и
 * Kinescope, и тест их не читает. Закрытая клетка — статус отказа по контракту маршрута без секрета,
 * ссылки и токена. Ответ access-state и mock authorize доказательством не служат.
 * Строки матрицы проверок доступа: `test/access-scenarios/access-check-matrix.ts`.
 */
describe("scoped Account access over Nest HTTP", () => {
  let app: NestFastifyApplication;
  let server: DeclaredServer;
  let database: TestDatabase;
  let identity: TestIdentityIssuer;
  let world: ScopedGuidesWorld;
  let config: PlatformConfig;

  beforeAll(async () => {
    identity = await startTestIdentityIssuer({
      issuer: "https://identity.scoped-http.test/oidc",
      audience: "https://api.scoped-http.test",
    });
    database = await createMigratedTestDatabase();
    world = await createScopedGuidesWorld(database);
    config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: database.url,
      LOGTO_ISSUER: identity.issuer,
      LOGTO_AUDIENCE: identity.audience,
      LOGTO_JWKS_URL: identity.jwksUrl,
      IDENTITY_EMAIL_FINGERPRINT_KEY: "scoped-http-email-fingerprint-key",
    });
    app = await createApiApplication(config, { logger: false });
    await app.init();
    server = declaredServer(app.getHttpAdapter().getInstance());
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await identity.close();
  });

  test("anonymous reader gets no protected bytes of either Guide while the public Material stays open", async () => {
    expect(await publicBody(null)).toBe("open");
    expect(await exposure(world.guideA, null)).toEqual(allClosed);
    expect(await exposure(world.guideB, null)).toEqual(allClosed);
  });

  test("Account without entitlement gets no protected bytes of either Guide while the public Material stays open", async () => {
    const { bearer } = await signedInAccount();
    expect(await publicBody(bearer)).toBe("open");
    expect(await exposure(world.guideA, bearer)).toEqual(allClosed);
    expect(await exposure(world.guideB, bearer)).toEqual(allClosed);
  });

  test("learner of Guide A reads its body, asset, video and practice list while Guide B stays closed", async () => {
    const { bearer, accountId } = await signedInAccount();
    await world.grantGuide(accountId, world.guideA.guideId);
    expect(await exposure(world.guideA, bearer)).toEqual(allOpen);
    expect(await exposure(world.guideB, bearer)).toEqual(allClosed);
  });

  test("learner of Guide B reads its body, asset, video and practice list while Guide A stays closed", async () => {
    const { bearer, accountId } = await signedInAccount();
    await world.grantGuide(accountId, world.guideB.guideId);
    expect(await exposure(world.guideB, bearer)).toEqual(allOpen);
    expect(await exposure(world.guideA, bearer)).toEqual(allClosed);
  });

  test("expired Guide A grant exposes no protected bytes while the public Material stays open", async () => {
    const { bearer, accountId } = await signedInAccount();
    await world.grantExpiredGuide(accountId, world.guideA.guideId);
    expect(await publicBody(bearer)).toBe("open");
    expect(await exposure(world.guideA, bearer)).toEqual(allClosed);
  });

  test("revoking Guide A closes the next request and the earlier playback token while Guide B stays open", async () => {
    const { bearer, accountId } = await signedInAccount();
    const grantA = await world.grantGuide(accountId, world.guideA.guideId);
    await world.grantGuide(accountId, world.guideB.guideId);
    expect(await exposure(world.guideA, bearer)).toEqual(allOpen);
    const earlier = await playback(world.guideA, bearer);
    expect(earlier.statusCode).toBe(200);
    const earlierToken = earlier.json<{ drmAuthToken: string }>().drmAuthToken;
    expect(await providerAuthorization(world.guideA, earlierToken)).toBe(200);

    await world.revokeGrant(grantA);

    expect(await exposure(world.guideA, bearer)).toEqual(allClosed);
    // Токен, выданный до отзыва, Kinescope перепроверяет у Platform: он больше ничего не открывает.
    expect(await providerAuthorization(world.guideA, earlierToken)).toBe(403);
    expect(await exposure(world.guideB, bearer)).toEqual(allOpen);
  });

  test("Materials-only and Billing-only Accounts get a typed denial on each other's write next to their own", async () => {
    const materialsOnly = await signedInAccount("materials:manage");
    const billingOnly = await signedInAccount("billing:manage");
    const topicId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, slug: `owner-${topicId}`, name: "Owner surfaces" },
    });
    const draft = {
      metadata: {
        title: "Черновик автора",
        summary: "Право materials:manage без других прав.",
        access: "free",
        topicId,
        formatId: "guide",
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [],
      },
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: randomUUID() },
              content: [{ type: "text", text: "Черновик" }],
            },
          ],
        },
      },
    };
    const createDraft = (bearer: string) =>
      server.inject({
        method: "POST",
        url: "/authoring/materials",
        headers: { ...headers(bearer), "idempotency-key": randomUUID() },
        payload: draft,
      });
    const offerId = randomUUID();
    const saveOffer = (
      bearer: string,
      name: string,
      expectedRevision?: number,
    ) =>
      server.inject({
        method: "POST",
        url: "/billing/admin",
        headers: headers(bearer),
        payload: {
          operation: "offers.save",
          operationId: randomUUID(),
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          value: {
            id: offerId,
            name,
            benefits: ["materials"],
            contentScope: { guideIds: [world.guideA.guideId], materialIds: [] },
          },
        },
      });

    // Каждый Account выполняет свою операцию записи: сессия и право рабочие.
    expect((await createDraft(materialsOnly.bearer)).statusCode).toBe(201);
    expect(
      (await saveOffer(billingOnly.bearer, "Тариф Billing-only")).statusCode,
    ).toBe(200);
    const materialsBefore = await database.prisma.material.count();
    const offerBefore = await database.prisma.billingOffer.findUniqueOrThrow({
      where: { id: offerId },
    });

    // Чужая операция — валидный запрос; к существующему Offer — с его текущей редакцией.
    const deniedDraft = await createDraft(billingOnly.bearer);
    expect(deniedDraft.statusCode).toBe(403);
    expect(deniedDraft.json()).toMatchObject({ code: "forbidden" });
    const deniedOffer = await saveOffer(
      materialsOnly.bearer,
      "Тариф Materials-only",
      offerBefore.revision,
    );
    expect(deniedOffer.statusCode).toBe(403);
    expect(deniedOffer.json()).toMatchObject({ code: "forbidden" });

    // Отказ не оставил durable следа.
    expect(await database.prisma.material.count()).toBe(materialsBefore);
    expect(
      await database.prisma.billingOffer.findUniqueOrThrow({
        where: { id: offerId },
      }),
    ).toEqual(offerBefore);
  });

  async function signedInAccount(
    permission?: "materials:manage" | "billing:manage",
  ): Promise<{
    readonly bearer: string;
    readonly accountId: string;
  }> {
    const subject = `scoped-http-${randomUUID()}`;
    const bearer = await identity.sign(subject, {
      inside_verified_email: `${subject}@example.test`,
    });
    const created = await server.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(created.statusCode).toBe(201);
    const account = await database.prisma.account.findFirstOrThrow({
      where: { logtoSubject: subject },
    });
    if (permission !== undefined) {
      await database.prisma.accountPermission.create({
        data: { accountId: account.id, permission },
      });
      await acceptCurrentTerms(server, headers(bearer));
    }
    return { bearer, accountId: account.id };
  }

  function headers(bearer: string | null) {
    return bearer === null ? {} : { authorization: `Bearer ${bearer}` };
  }

  async function publicBody(bearer: string | null): Promise<"open"> {
    const response = await server.inject({
      method: "GET",
      url: `/materials/${world.publicMaterial.slug}`,
      headers: headers(bearer),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(world.publicMaterial.bodyText);
    return "open";
  }

  function playback(guide: ScopedGuide, bearer: string | null) {
    return server.inject({
      method: "POST",
      url: `/materials/${guide.materialId}/videos/${guide.videoId}/playback`,
      headers: headers(bearer),
    });
  }

  async function providerAuthorization(
    guide: ScopedGuide,
    token: string,
  ): Promise<number> {
    const { callbackUsername, callbackPassword } = config.kinescope;
    const basic = Buffer.from(
      `${callbackUsername}:${callbackPassword}`,
    ).toString("base64");
    const response = await server.inject({
      method: "POST",
      url: "/integrations/kinescope/v1/authorize",
      headers: { authorization: `Basic ${basic}` },
      payload: { id: guide.providerVideoId, token },
    });
    return response.statusCode;
  }

  /**
   * Что Account получает от каждой защищённой поверхности Guide. «open» — тело или список заданий
   * несут секрет Guide, файл отвечает подписанной ссылкой на свой объект, видео — DRM-токеном.
   * «closed» — отказ по контракту маршрута без секрета, ссылки и токена. Любой третий исход роняет
   * тест с описанием ответа.
   */
  async function exposure(
    guide: ScopedGuide,
    bearer: string | null,
  ): Promise<Exposure> {
    const auth = headers(bearer);
    const [body, asset, video, practices] = await Promise.all([
      server.inject({
        method: "GET",
        url: `/materials/${guide.slug}`,
        headers: auth,
      }),
      server.inject({
        method: "GET",
        url: `/materials/${guide.materialId}/assets/${guide.assetId}?contentVersion=${String(guide.contentVersion)}`,
        headers: auth,
      }),
      playback(guide, bearer),
      server.inject({
        method: "GET",
        url: `/library/materials/${guide.slug}/practices`,
        headers: auth,
      }),
    ]);
    return {
      // Закрытое тело отвечает 200 с тизером: отказ — это вид ответа, а не статус.
      body: classify("body", body, {
        open: body.statusCode === 200 && body.body.includes(guide.bodySecret),
        closed:
          body.statusCode === 200 &&
          body.json<{ kind: string }>().kind === "teaser" &&
          !body.body.includes(guide.bodySecret),
      }),
      // Защищённый файл — короткая подписанная ссылка на объект; отказ маскируется как 404.
      assets: classify("assets", asset, {
        open:
          asset.statusCode === 302 &&
          (asset.headers.location ?? "").includes(guide.protectedObjectKey),
        closed:
          asset.statusCode === 404 &&
          asset.headers.location === undefined &&
          !asset.body.includes(guide.protectedObjectKey),
      }),
      video: classify("video", video, {
        open:
          video.statusCode === 200 &&
          video.json<{ drmAuthToken: string | null }>().drmAuthToken !== null &&
          video.body.includes(guide.providerVideoId),
        closed:
          video.statusCode === 403 &&
          video.json<{ code: string }>().code === "access_denied" &&
          !video.body.includes(guide.providerVideoId),
      }),
      "practice-list": classify("practice-list", practices, {
        open:
          practices.statusCode === 200 &&
          practices.body.includes(guide.practiceSecret),
        closed:
          practices.statusCode === 404 &&
          practices.json<{ code: string }>().code ===
            "practice_not_available" &&
          !practices.body.includes(guide.practiceSecret),
      }),
    };
  }

  function classify(
    surface: Surface,
    response: { statusCode: number; body: string },
    verdict: { readonly open: boolean; readonly closed: boolean },
  ): "open" | "closed" {
    if (verdict.open) return "open";
    if (verdict.closed) return "closed";
    throw new Error(
      `${surface} answered neither open nor closed: ${String(response.statusCode)} ${response.body.slice(0, 300)}`,
    );
  }
});
