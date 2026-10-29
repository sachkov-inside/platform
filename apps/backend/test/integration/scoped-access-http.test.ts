import { registerFixedClock } from "../support/fixed-clock.js";

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
  createScopedProductsWorld,
  type ScopedProduct,
  type ScopedProductsWorld,
} from "./setup/scoped-products.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

/** Защищённые чтения, которые матрица проверок доступа называет поверхностями Product. */
const surfaces = ["body", "assets", "video", "task-context"] as const;
type Surface = (typeof surfaces)[number];
type Exposure = Readonly<Record<Surface, "open" | "closed">>;
const allOpen: Exposure = {
  body: "open",
  assets: "open",
  video: "open",
  "task-context": "open",
};
const allClosed: Exposure = {
  body: "closed",
  assets: "closed",
  video: "closed",
  "task-context": "closed",
};

/**
 * Scoped Account через настоящий Nest HTTP (#903, пробел 7 из #902): API поднят целиком, Account
 * входит подписанным токеном, доступ даёт lifetime Product Access одного Product. Тело и требования задания
 * открыты, когда ответ несёт секрет Product. Файл открыт, когда ответ — подписанная ссылка на его
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
  let world: ScopedProductsWorld;
  let config: PlatformConfig;

  beforeAll(async () => {
    identity = await startTestIdentityIssuer({
      issuer: "https://identity.scoped-http.test/oidc",
      audience: "https://api.scoped-http.test",
    });
    database = await createMigratedTestDatabase();
    world = await createScopedProductsWorld(database);
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

  test("anonymous reader gets no protected bytes of either Product while the public Material stays open", async () => {
    expect(await publicBody(null)).toBe("open");
    expect(await exposure(world.productA, null)).toEqual(allClosed);
    expect(await exposure(world.productB, null)).toEqual(allClosed);
  });

  test("Account without entitlement gets no protected bytes of either Product while the public Material stays open", async () => {
    const { bearer } = await signedInAccount();
    expect(await publicBody(bearer)).toBe("open");
    expect(await exposure(world.productA, bearer)).toEqual(allClosed);
    expect(await exposure(world.productB, bearer)).toEqual(allClosed);
  });

  test("learner of Product A reads its body, asset, video and Task context while Product B stays closed", async () => {
    const { bearer, accountId } = await signedInAccount();
    await world.grantProduct(accountId, world.productA.productId);
    expect(await exposure(world.productA, bearer)).toEqual(allOpen);
    expect(await exposure(world.productB, bearer)).toEqual(allClosed);
  });

  test("learner of Product B reads its body, asset, video and Task context while Product A stays closed", async () => {
    const { bearer, accountId } = await signedInAccount();
    await world.grantProduct(accountId, world.productB.productId);
    expect(await exposure(world.productB, bearer)).toEqual(allOpen);
    expect(await exposure(world.productA, bearer)).toEqual(allClosed);
  });

  test("expired Product A grant exposes no protected bytes while the public Material stays open", async () => {
    const { bearer, accountId } = await signedInAccount();
    await world.grantExpiredProduct(accountId, world.productA.productId);
    expect(await publicBody(bearer)).toBe("open");
    expect(await exposure(world.productA, bearer)).toEqual(allClosed);
  });

  test("revoking Product A closes the next request and the earlier playback token while Product B stays open", async () => {
    const { bearer, accountId } = await signedInAccount();
    const grantA = await world.grantProduct(
      accountId,
      world.productA.productId,
    );
    await world.grantProduct(accountId, world.productB.productId);
    expect(await exposure(world.productA, bearer)).toEqual(allOpen);
    const earlier = await playback(world.productA, bearer);
    expect(earlier.statusCode).toBe(200);
    const earlierToken = earlier.json<{ drmAuthToken: string }>().drmAuthToken;
    expect(await providerAuthorization(world.productA, earlierToken)).toBe(200);

    await world.revokeGrant(grantA);

    expect(await exposure(world.productA, bearer)).toEqual(allClosed);
    // Токен, выданный до отзыва, Kinescope перепроверяет у Platform: он больше ничего не открывает.
    expect(await providerAuthorization(world.productA, earlierToken)).toBe(403);
    expect(await exposure(world.productB, bearer)).toEqual(allOpen);
  });

  test("free Task requirements remain open without Product Access for anonymous and signed-in readers", async () => {
    const { bearer } = await signedInAccount();
    for (const token of [null, bearer]) {
      const task = await server.inject({
        method: "GET",
        url: `/library/materials/${world.freeProduct.materialId}/task`,
        headers: headers(token),
      });
      expect(task.statusCode).toBe(200);
      expect(task.json()).toMatchObject({ access: "open" });
      expect(task.body).toContain(world.freeProduct.taskSecret);
    }
  });

  test("free lesson gives a guest and an Account without entitlement a playback token that Kinescope accepts", async () => {
    const { bearer } = await signedInAccount();
    for (const token of [null, bearer]) {
      const session = await playback(world.freeProduct, token);
      expect(session.statusCode).toBe(200);
      // The free lesson's recording is protected too (ADR 0041): every viewer needs a token.
      const { drmAuthToken } = session.json<{ drmAuthToken: string | null }>();
      if (drmAuthToken === null) throw new Error("free lesson token missing");
      expect(await providerAuthorization(world.freeProduct, drmAuthToken)).toBe(
        200,
      );
      expect((await playback(world.productA, token)).statusCode).toBe(403);
    }
  });

  test("retired Practice routes remain absent even for a Product holder", async () => {
    const { bearer, accountId } = await signedInAccount();
    await world.grantProduct(accountId, world.productA.productId);
    for (const product of [world.productA, world.productB]) {
      const retired = await server.inject({
        method: "GET",
        url: `/library/materials/${product.slug}/practices`,
        headers: headers(bearer),
      });
      expect(retired.statusCode).toBe(404);
      expect(retired.body).not.toContain(product.taskSecret);
      expect(retired.body).not.toContain(product.bodySecret);
    }
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
        productIds: [],
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
    const offerId = world.productA.productId;
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
          operation: "productPrices.save",
          operationId: randomUUID(),
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          value: {
            productId: offerId,
            name,
            priceKopecks: 100000,
            published: false,
          },
        },
      });

    // Каждый Account выполняет свою операцию записи: сессия и право рабочие.
    expect((await createDraft(materialsOnly.bearer)).statusCode).toBe(201);
    expect(
      (await saveOffer(billingOnly.bearer, "Product Billing-only")).statusCode,
    ).toBe(200);
    const materialsBefore = await database.prisma.material.count();
    const offerBefore =
      await database.prisma.billingProductPrice.findUniqueOrThrow({
        where: { productId: offerId },
      });

    // Чужая операция — валидный запрос; к существующему Offer — с его текущей редакцией.
    const deniedDraft = await createDraft(billingOnly.bearer);
    expect(deniedDraft.statusCode).toBe(403);
    expect(deniedDraft.json()).toMatchObject({ code: "forbidden" });
    const deniedOffer = await saveOffer(
      materialsOnly.bearer,
      "Product Materials-only",
      offerBefore.revision,
    );
    expect(deniedOffer.statusCode).toBe(403);
    expect(deniedOffer.json()).toMatchObject({ code: "forbidden" });

    // Отказ не оставил durable следа.
    expect(await database.prisma.material.count()).toBe(materialsBefore);
    expect(
      await database.prisma.billingProductPrice.findUniqueOrThrow({
        where: { productId: offerId },
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

  function playback(product: ScopedProduct, bearer: string | null) {
    return server.inject({
      method: "POST",
      url: `/materials/${product.materialId}/videos/${product.videoId}/playback`,
      headers: headers(bearer),
    });
  }

  async function providerAuthorization(
    product: ScopedProduct,
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
      payload: { id: product.providerVideoId, token },
    });
    return response.statusCode;
  }

  /**
   * Что Account получает от каждой защищённой поверхности Product. «open» — тело или требования задания
   * несут секрет Product, файл отвечает подписанной ссылкой на свой объект, видео — DRM-токеном.
   * «closed» — отказ по контракту маршрута без секрета, ссылки и токена. Любой третий исход роняет
   * тест с описанием ответа.
   */
  async function exposure(
    product: ScopedProduct,
    bearer: string | null,
  ): Promise<Exposure> {
    const auth = headers(bearer);
    const assetUrl = `/materials/${product.materialId}/assets/${product.assetId}?contentVersion=${String(product.contentVersion)}`;
    const [body, asset, edgeAsset, video, task] = await Promise.all([
      server.inject({
        method: "GET",
        url: `/materials/${product.slug}`,
        headers: auth,
      }),
      server.inject({ method: "GET", url: assetUrl, headers: auth }),
      // Caddy's protected-delivery route marks the request (#1766): the same access decision, but
      // the signed address goes to the internal header for the edge instead of a browser redirect.
      server.inject({
        method: "GET",
        url: assetUrl,
        headers: { ...auth, "x-inside-storage-delivery": "edge" },
      }),
      playback(product, bearer),
      server.inject({
        method: "GET",
        url: `/library/materials/${product.materialId}/task`,
        headers: auth,
      }),
    ]);
    return {
      // Закрытое тело отвечает 200 с тизером: отказ — это вид ответа, а не статус.
      body: classify("body", body, {
        open: body.statusCode === 200 && body.body.includes(product.bodySecret),
        closed:
          body.statusCode === 200 &&
          body.json<{ kind: string }>().kind === "teaser" &&
          !body.body.includes(product.bodySecret),
      }),
      // Защищённый файл — короткая подписанная ссылка на объект; отказ маскируется как 404.
      // Ответ для Caddy (#1766) открыт и закрыт ровно там же, где redirect для браузера.
      assets: agreed(
        classify("assets", asset, {
          open:
            asset.statusCode === 302 &&
            (asset.headers.location ?? "").includes(
              product.protectedObjectKey,
            ) &&
            asset.headers["x-inside-storage-location"] === undefined,
          closed:
            asset.statusCode === 404 &&
            asset.headers.location === undefined &&
            !asset.body.includes(product.protectedObjectKey),
        }),
        classify("assets", edgeAsset, {
          open:
            edgeAsset.statusCode === 204 &&
            edgeAsset.headers.location === undefined &&
            String(edgeAsset.headers["x-inside-storage-location"]).includes(
              product.protectedObjectKey,
            ) &&
            edgeAsset.headers["x-inside-storage-cache-control"] ===
              "private, max-age=31536000, immutable" &&
            edgeAsset.headers["cache-control"] === "private, no-store" &&
            edgeAsset.body === "",
          closed:
            edgeAsset.statusCode === 404 &&
            edgeAsset.headers.location === undefined &&
            edgeAsset.headers["x-inside-storage-location"] === undefined &&
            !edgeAsset.body.includes(product.protectedObjectKey),
        }),
      ),
      video: classify("video", video, {
        open:
          video.statusCode === 200 &&
          video.json<{ drmAuthToken: string | null }>().drmAuthToken !== null &&
          video.body.includes(product.providerVideoId),
        closed:
          video.statusCode === 403 &&
          video.json<{ code: string }>().code === "access_denied" &&
          !video.body.includes(product.providerVideoId),
      }),
      "task-context": classify("task-context", task, {
        open:
          task.statusCode === 200 &&
          task.json<{ access: string }>().access === "open" &&
          task.body.includes(product.taskSecret),
        closed:
          task.statusCode === 200 &&
          task.json<{ access: string }>().access === "closed" &&
          !(
            "definition" in task.json<{ task: Record<string, unknown> }>().task
          ) &&
          !task.body.includes(product.taskSecret),
      }),
    };
  }

  function agreed(
    browser: "open" | "closed",
    edge: "open" | "closed",
  ): "open" | "closed" {
    if (browser !== edge)
      throw new Error(`asset redirect is ${browser}, edge answer is ${edge}`);
    return browser;
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
