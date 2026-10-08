import {
  expect,
  test as baseTest,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import { backendFixtureInstant } from "../support/backend-fixture-clock";

import {
  fullStackBaseUrl,
  fullStackBrowserRequest,
  signInFullStack,
  type FullStackRole,
} from "../support/full-stack-session";

// The context fixture retains video for the helper's page, which closes before the test continues.
const test = baseTest.extend({ video: "retain-on-failure" });

/**
 * Права через настоящий Web/BFF отдельными identities (#904). У каждой identity одно основание,
 * поэтому отказ доказывает границу права, а не отсутствие сессии. Каждый отказ стоит рядом с
 * разрешённой соседней возможностью того же Account, а запрещённый write — валидный запрос к
 * существующему ресурсу, после которого наблюдатель с правом читает то же состояние.
 */

/** Product A — сидовый продукт «Создание Platform Inside» с закрытым материалом. */
const productA = {
  id: "72000000-0000-4000-8000-000000000007",
  closedSlug: "developer-pipeline-bez-poteri-konteksta",
  closedBody: "Закрытое содержимое для участников.",
} as const;
/** Product B — изолированный «Synthetic practice», который запускатор создаёт для прогона. */
const productB = {
  closedBody: "FULLSTACK_PRIVATE_PRACTICE_BODY",
} as const;
/** Сидовое предложение «Материалы»: существующий ресурс для запрещённой Billing mutation. */
const seededOfferId = "72000000-0000-4000-8000-000000000501";
/** Сидовый опубликованный бесплатный материал: существующий ресурс для Materials mutation. */
const publishedMaterial = {
  slug: "kak-ustroen-inside-platform",
  title: "Как устроен Inside Platform",
} as const;

const billingDenial = { ok: false, code: "forbidden" } as const;
const materialsDenial = { kind: "forbidden" } as const;

const tierItemsSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    result: z.object({
      items: z.array(
        z.object({
          tier: z.object({
            id: z.string(),
            name: z.string(),
            revision: z.number(),
          }),
        }),
      ),
    }),
  }),
});
const authoringMaterialsSchema = z.object({
  kind: z.literal("ready"),
  items: z.array(
    z.object({
      materialId: z.string(),
      title: z.string().nullable(),
      contentVersion: z.number(),
      publicationState: z.string(),
    }),
  ),
});
/** Успешная Billing-команда над одной записью: тариф или назначение с его ревизией. */
const billingRecordSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    result: z.object({
      value: z
        .object({ id: z.string(), revision: z.number() })
        .and(z.object({ state: z.string().optional() })),
    }),
  }),
});
const billingEnrollmentSchema = billingRecordSchema.and(
  z.object({
    value: z.object({
      result: z.object({
        value: z.object({
          startsAt: z.iso.datetime(),
          endsAt: z.iso.datetime().nullable(),
          endPolicy: z.enum([
            "fixed",
            "confirmed_external",
            "temporary_membership",
          ]),
        }),
      }),
    }),
  }),
);
type BillingEnrollment = z.infer<
  typeof billingEnrollmentSchema
>["value"]["result"]["value"];
const bookmarkStatesSchema = z.object({
  kind: z.literal("ready"),
  states: z.array(
    z.object({ materialId: z.string(), bookmarked: z.boolean() }),
  ),
});
const readingStatesSchema = z.object({
  kind: z.literal("ready"),
  states: z.array(
    z.object({
      materialId: z.string(),
      isRead: z.boolean(),
      version: z.number(),
    }),
  ),
});
const bookmarkListSchema = z.object({
  items: z.array(z.object({ materialId: z.string() })),
});

interface SignedIn {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** Отдельный browser context под своей identity; страница уже стоит на origin приложения. */
async function openAs(
  browser: Browser,
  role: FullStackRole,
  fixtureContext?: BrowserContext,
) {
  const context =
    fixtureContext ??
    (await browser.newContext({ baseURL: fullStackBaseUrl() }));
  await signInFullStack(context, role);
  const page = await context.newPage();
  await page.goto("/account");
  return { context, page } satisfies SignedIn;
}

async function accountIdOf(page: Page): Promise<string> {
  const status = await fullStackBrowserRequest(page, "/auth/status");
  return z.object({ accountId: z.uuid() }).parse(await status.json()).accountId;
}

/** Billing BFF: каждая операция — POST с одним полем `input`; HTTP 200 и typed result в теле. */
async function billing(
  page: Page,
  operation: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const response = await fullStackBrowserRequest(
    page,
    `/api/authoring/billing/${operation}`,
    "POST",
    { input: JSON.stringify({ operationId: crypto.randomUUID(), ...input }) },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

/** Значение тарифа «материалы только Product A»: так устроено и сидовое предложение «Материалы». */
function productAOffer(id: string, name: string) {
  return {
    id,
    name,
    benefits: ["materials"],
    availableForAssignment: true,
    coverage: { productIds: [productA.id], materialIds: [] },
  };
}

async function seededOffer(observer: Page) {
  const listed = tierItemsSchema.parse(
    await billing(observer, "tiers/list", { limit: 100 }),
  );
  const offer = listed.value.result.items.find(
    ({ tier }) => tier.id === seededOfferId,
  )?.tier;
  if (offer === undefined) throw new Error("Seeded offer is missing");
  return offer;
}

/** Валидное переименование существующего предложения с его текущей ревизией. */
function renameSeededOffer(page: Page, offer: { readonly revision: number }) {
  return billing(page, "offers/save", {
    expectedRevision: offer.revision,
    value: productAOffer(seededOfferId, "Переименовано без права"),
  });
}

async function authoringMaterial(observer: Page) {
  const response = await fullStackBrowserRequest(
    observer,
    `/api/authoring/materials?search=${encodeURIComponent(publishedMaterial.title)}`,
  );
  expect(response.status()).toBe(200);
  const material = authoringMaterialsSchema
    .parse(await response.json())
    .items.find(({ title }) => title === publishedMaterial.title);
  if (material === undefined) throw new Error("Seeded material is missing");
  return material;
}

/** Валидное снятие с публикации существующего материала с его текущей версией. */
async function unpublishMaterial(
  page: Page,
  material: { readonly materialId: string; readonly contentVersion: number },
) {
  const response = await fullStackBrowserRequest(
    page,
    "/api/authoring/materials",
    "PATCH",
    {
      materialId: material.materialId,
      expectedContentVersion: String(material.contentVersion),
      publicationState: "unpublished",
      submissionId: crypto.randomUUID(),
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

/** Открывает материал Reader-ом и ждёт, пока он покажет `available` или `access-required`. */
async function openMaterial(
  page: Page,
  slug: string,
  state: "available" | "access-required",
) {
  await page.goto(`/materials/${slug}`);
  await expect(
    page.locator(`[data-material-reader-state="${state}"]`),
  ).toBeVisible();
}

async function openClosedBody(page: Page, slug: string, body: string) {
  await openMaterial(page, slug, "available");
  await expect(page.getByText(body, { exact: true })).toBeVisible();
}

/**
 * Отказ на закрытый материал без его bytes: ни в разметке страницы, ни в повторном запросе из
 * браузера через его HTTP-кэш. Клиентский кэш маршрутов открытой вкладки запроса не делает и здесь
 * не проверяется: отзыв доходит до неё не позже чем через 60 секунд (ADR 0027, «Клиентский кеш
 * маршрутов»).
 */
async function openDeniedBody(page: Page, slug: string, body: string) {
  await openMaterial(page, slug, "access-required");
  expect(await page.content()).not.toContain(body);
  const html = await page.evaluate(
    async (path) => (await fetch(path)).text(),
    `/materials/${slug}`,
  );
  expect(html).not.toContain(body);
}

test("Materials-only opens material tools and is denied a Billing mutation without a durable effect", async ({
  browser,
}) => {
  const author = await openAs(browser, "MATERIALS_ONLY");
  const observer = await openAs(browser, "BILLING_ONLY");
  try {
    await author.page.goto("/authoring/materials");
    await expect(
      author.page
        .getByRole("region", { name: "Список материалов" })
        .getByText(publishedMaterial.title, { exact: true }),
    ).toBeVisible();
    expect((await authoringMaterial(author.page)).publicationState).toBe(
      "published",
    );

    const before = await seededOffer(observer.page);
    expect(await renameSeededOffer(author.page, before)).toEqual(billingDenial);
    expect(await billing(author.page, "tiers/list", { limit: 100 })).toEqual(
      billingDenial,
    );
    expect(await seededOffer(observer.page)).toEqual(before);
  } finally {
    await author.context.close();
    await observer.context.close();
  }
});

test("Billing-only opens billing tools and is denied a Materials mutation without a durable effect", async ({
  browser,
  context,
}) => {
  const billingManager = await openAs(browser, "BILLING_ONLY", context);
  const observer = await openAs(browser, "MATERIALS_ONLY");
  try {
    await billingManager.page.goto("/authoring/billing");
    await expect(
      billingManager.page.getByRole("heading", {
        name: "Тарифы и назначения",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      billingManager.page.getByRole("heading", {
        name: "Назначить тариф",
        exact: true,
      }),
    ).toBeVisible();
    expect((await seededOffer(billingManager.page)).name).toBe("Материалы");

    const before = await authoringMaterial(observer.page);
    expect(await unpublishMaterial(billingManager.page, before)).toEqual(
      materialsDenial,
    );
    // Кроме mutation закрыто и чтение списка инструментов материалов.
    const listed = await fullStackBrowserRequest(
      billingManager.page,
      "/api/authoring/materials",
    );
    expect(listed.status()).toBe(403);
    expect(await listed.json()).toEqual(materialsDenial);
    await billingManager.page.goto("/authoring/materials");
    await expect(
      billingManager.page.getByRole("heading", {
        name: "Нет доступа к материалам",
        exact: true,
      }),
    ).toBeVisible();
    expect(await authoringMaterial(observer.page)).toMatchObject({
      contentVersion: before.contentVersion,
      publicationState: "published",
    });
  } finally {
    await billingManager.context.close();
    await observer.context.close();
  }
});

test("an ordinary Account is denied Materials and Billing mutations on existing resources without a durable effect", async ({
  browser,
}) => {
  const reader = await openAs(browser, "READER_A");
  const materialsObserver = await openAs(browser, "MATERIALS_ONLY");
  const billingObserver = await openAs(browser, "BILLING_ONLY");
  try {
    // Соседняя разрешённая возможность того же Account: открыть опубликованный материал.
    await openMaterial(reader.page, publishedMaterial.slug, "available");

    const material = await authoringMaterial(materialsObserver.page);
    expect(await unpublishMaterial(reader.page, material)).toEqual(
      materialsDenial,
    );
    expect(await authoringMaterial(materialsObserver.page)).toMatchObject({
      contentVersion: material.contentVersion,
      publicationState: "published",
    });

    const offer = await seededOffer(billingObserver.page);
    expect(await renameSeededOffer(reader.page, offer)).toEqual(billingDenial);
    expect(await seededOffer(billingObserver.page)).toEqual(offer);
  } finally {
    await reader.context.close();
    await materialsObserver.context.close();
    await billingObserver.context.close();
  }
});

test("a learner scoped to Product A reads Product A, is denied Product B and loses Product A on revocation", async ({
  browser,
}) => {
  const productBSlug = process.env["FULLSTACK_PRACTICE_SLUG"];
  if (productBSlug === undefined)
    throw new Error("Missing Product B fixture (FULLSTACK_PRACTICE_SLUG)");
  const learner = await openAs(browser, "PRODUCT_A_LEARNER");
  const billingManager = await openAs(browser, "BILLING_ONLY");
  const terms = {
    startsAt: await backendFixtureInstant(billingManager.page.request),
    endsAt: null,
    endPolicy: "fixed",
  };
  const revoke = async (enrollment: BillingEnrollment) =>
    billingEnrollmentSchema.parse(
      await billing(billingManager.page, "enrollments/change", {
        enrollmentId: enrollment.id,
        expectedRevision: enrollment.revision,
        action: "revoke",
        terms: {
          startsAt: enrollment.startsAt,
          endsAt: enrollment.endsAt,
          endPolicy: enrollment.endPolicy,
        },
        reason: "Scoped learner access check revoked",
      }),
    ).value.result.value;
  // Назначение, которое ещё не отозвано: упавший прогон не оставляет ученику доступ к Product A
  // для следующего прогона того же набора.
  let activeEnrollment: BillingEnrollment | undefined;
  try {
    // Без назначения Product A закрыт, а бесплатный материал открыт: доступ к A даст только
    // назначение ниже, и отказ здесь не следствие сломанной сессии.
    await openMaterial(learner.page, publishedMaterial.slug, "available");
    await openDeniedBody(
      learner.page,
      productA.closedSlug,
      productA.closedBody,
    );

    const tierId = crypto.randomUUID();
    const tier = billingRecordSchema.parse(
      await billing(billingManager.page, "offers/save", {
        value: productAOffer(tierId, `Только Product A ${tierId}`),
      }),
    ).value.result.value;
    const assigned = billingEnrollmentSchema.parse(
      await billing(billingManager.page, "enrollments/assign", {
        accountId: await accountIdOf(learner.page),
        origin: "manual",
        sourceRef: `access-identities-${tierId}`,
        tierId,
        tierRevision: tier.revision,
        terms,
        billingRef: null,
        reason: "Scoped learner access check",
      }),
    ).value.result.value;
    activeEnrollment = assigned;
    expect(assigned.state).toBe("active");

    await openClosedBody(
      learner.page,
      productA.closedSlug,
      productA.closedBody,
    );
    await openDeniedBody(learner.page, productBSlug, productB.closedBody);

    const revoked = await revoke(assigned);
    expect(revoked.state).toBe("revoked");
    activeEnrollment = undefined;

    // Тело Product A этот браузер и сервер уже отдавали. Следующий запрос получает отказ: прежний
    // ответ с телом не вернулся ни из HTTP-кэша браузера, ни из кэшей сервера.
    await openDeniedBody(
      learner.page,
      productA.closedSlug,
      productA.closedBody,
    );
    await openMaterial(learner.page, publishedMaterial.slug, "available");
  } finally {
    try {
      if (activeEnrollment !== undefined)
        expect((await revoke(activeEnrollment)).state).toBe("revoked");
    } finally {
      await learner.context.close();
      await billingManager.context.close();
    }
  }
});

test("two separate Accounts cannot read or change each other's progress and bookmarks", async ({
  browser,
}) => {
  const owner = await openAs(browser, "READER_A");
  const stranger = await openAs(browser, "READER_B");
  try {
    const ownerAccountId = await accountIdOf(owner.page);
    expect(await accountIdOf(stranger.page)).not.toBe(ownerAccountId);

    await openMaterial(owner.page, publishedMaterial.slug, "available");
    const materialId = await owner.page
      .locator('[data-material-reader-state="available"]')
      .getAttribute("data-material-id");
    if (materialId === null) throw new Error("Reader has no Material ID");

    /** Состояния одного материала: закладка и прогресс приходят одинаковым POST со списком ID. */
    const statesOf = async (page: Page, path: string): Promise<unknown> => {
      const response = await fullStackBrowserRequest(page, path, "POST", {
        materialId,
      });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const bookmarks = async (page: Page) =>
      bookmarkStatesSchema.parse(await statesOf(page, "/api/bookmarks/states"))
        .states;
    const reading = async (page: Page) =>
      readingStatesSchema.parse(
        await statesOf(page, "/api/reading-progress/states"),
      ).states;
    const setBookmark = async (page: Page, bookmarked: boolean) => {
      const response = await fullStackBrowserRequest(
        page,
        "/api/bookmarks/state",
        "PUT",
        { materialId, bookmarked: String(bookmarked) },
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({
        kind: "ready",
        state: { materialId, bookmarked },
      });
    };
    const setRead = async (page: Page, isRead: boolean) => {
      const version = (await reading(page))[0]?.version ?? 0;
      const response = await fullStackBrowserRequest(
        page,
        "/api/reading-progress/state",
        "PUT",
        {
          materialId,
          commandId: crypto.randomUUID(),
          expectedVersion: String(version),
          isRead: String(isRead),
        },
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({
        kind: "saved",
        state: { materialId, isRead },
      });
    };
    const bookmarkList = async (page: Page) => {
      const response = await fullStackBrowserRequest(page, "/api/bookmarks");
      expect(response.status()).toBe(200);
      return bookmarkListSchema
        .parse(await response.json())
        .items.map((item) => item.materialId);
    };

    await setBookmark(owner.page, true);
    await setRead(owner.page, true);
    const ownerReading = await reading(owner.page);
    expect(await bookmarkList(owner.page)).toContain(materialId);

    // Чужой Account не видит отметок владельца ни в состояниях, ни в списке закладок.
    expect(await bookmarks(stranger.page)).toEqual([
      expect.objectContaining({ materialId, bookmarked: false }),
    ]);
    expect(await reading(stranger.page)).toEqual([
      expect.objectContaining({ materialId, isRead: false }),
    ]);
    expect(await bookmarkList(stranger.page)).not.toContain(materialId);

    // У BFF закладок и прогресса нет поля Account: его задаёт сессия. Поэтому подставить можно
    // только ID того же материала. Команды чужого Account проходят и меняют его собственные
    // отметки, а отметки владельца остаются прежними.
    await setBookmark(stranger.page, true);
    await setBookmark(stranger.page, false);
    await setRead(stranger.page, true);
    await setRead(stranger.page, false);
    // Account ID принимают только маршруты Billing, и они требуют `billing:manage`.
    expect(
      await billing(stranger.page, "grants/read", {
        accountId: ownerAccountId,
      }),
    ).toEqual(billingDenial);
    expect(
      await billing(stranger.page, "enrollments/list", {
        accountId: ownerAccountId,
      }),
    ).toEqual(billingDenial);

    expect(await bookmarks(owner.page)).toEqual([
      expect.objectContaining({ materialId, bookmarked: true }),
    ]);
    expect(await reading(owner.page)).toEqual(ownerReading);
    // В браузере владелец видит свою отметку, чужой Account — нет.
    for (const [viewer, pressed] of [
      [owner.page, "true"],
      [stranger.page, "false"],
    ] as const) {
      await viewer.goto(`/materials/${publishedMaterial.slug}`);
      const action = viewer.locator("[data-reading-action-state]:visible");
      await expect(action).toHaveAttribute(
        "data-reading-action-state",
        "ready",
      );
      await expect(
        action.getByRole("button", { name: "Изучено", exact: true }),
      ).toHaveAttribute("aria-pressed", pressed);
    }
  } finally {
    await owner.context.close();
    await stranger.context.close();
  }
});
