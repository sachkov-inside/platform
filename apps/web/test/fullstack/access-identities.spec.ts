import {
  expect,
  test as baseTest,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

import {
  fullStackBaseUrl,
  fullStackBrowserJsonRequest,
  fullStackBrowserRequest,
  signInFullStack,
  type FullStackRole,
} from "../support/full-stack-session";

// The context fixture retains video for the helper's page, which closes before the test continues.
const test = baseTest.extend({ video: "retain-on-failure" });

/**
 * Права через настоящий Web/BFF отдельными identities (#904). У каждой identity одно основание,
 * поэтому отказ доказывает границу права, а не отсутствие сессии. Каждый отказ стоит рядом с
 * разрешённой соседней возможностью того же Account, а запрещённый write, валидный запрос к
 * существующему ресурсу, после которого наблюдатель с правом читает то же состояние.
 */

/** Product A, сидовый продукт «Создание Platform Inside» с закрытым материалом. */
const productA = {
  id: "72000000-0000-4000-8000-000000000007",
  closedSlug: "developer-pipeline-bez-poteri-konteksta",
  closedBody: "Закрытое содержимое для участников.",
} as const;
/** Product B, изолированный «Synthetic practice», который запускатор создаёт для прогона. */
const productB = {
  closedBody: "FULLSTACK_PRIVATE_PRACTICE_BODY",
} as const;
/** Сидовый опубликованный бесплатный материал, существующий ресурс для Materials mutation. */
const publishedMaterial = {
  slug: "kak-ustroen-inside-platform",
  title: "Как устроен Inside Platform",
} as const;

const billingDenial = { ok: false, code: "forbidden" } as const;
const materialsDenial = { kind: "forbidden" } as const;

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
const priceSchema = z.object({
  product: z.object({ id: z.uuid(), name: z.string(), priceRevision: z.int() }),
  paymentOption: z.object({ priceKopecks: z.int() }),
});
const accessSchema = z.object({
  accountId: z.uuid(),
  productId: z.uuid(),
  access: z.enum(["active", "revoked"]),
  revision: z.int(),
  firstIssuedAt: z.iso.datetime().nullable(),
});
const accessResult = z.object({
  ok: z.literal(true),
  value: z.object({ value: accessSchema }),
});
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

/** Billing BFF: каждая операция — POST с JSON-телом операции; HTTP 200 и typed result в теле. */
async function billing(
  page: Page,
  operation: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const response = await fullStackBrowserJsonRequest(
    page,
    `/api/authoring/billing/${operation}`,
    "POST",
    { operationId: crypto.randomUUID(), ...input },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

async function seededOffer(observer: Page) {
  const response = await fullStackBrowserRequest(
    observer,
    "/api/authoring/billing/catalog",
  );
  const prices = z
    .object({ ok: z.literal(true), value: z.array(priceSchema) })
    .parse(await response.json()).value;
  const price = prices.find((item) => item.product.id === productA.id);
  if (price === undefined) throw new Error("Seeded Product price is missing");
  return price;
}
function renameSeededOffer(page: Page, price: z.infer<typeof priceSchema>) {
  return billing(page, "product-prices/save", {
    expectedRevision: price.product.priceRevision,
    value: {
      productId: price.product.id,
      name: "Переименовано без права",
      priceKopecks: price.paymentOption.priceKopecks,
      published: true,
    },
  });
}
/** An owner people read (#1721) answered to an Account without `billing:manage`. */
async function peopleRead(page: Page, path: string) {
  const response = await fullStackBrowserRequest(page, path);
  return { status: response.status(), body: await response.json() };
}
const peopleDenial = { status: 403, body: { kind: "forbidden" } } as const;

async function access(
  page: Page,
  operation: string,
  input: Record<string, unknown>,
) {
  const response = await fullStackBrowserJsonRequest(
    page,
    `/api/authoring/access/products/${operation}`,
    "POST",
    input,
  );
  expect(response.status()).toBe(200);
  return response.json();
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
  const response = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/materials",
    "PATCH",
    {
      materialId: material.materialId,
      expectedContentVersion: material.contentVersion,
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
    // Предыдущие сценарии создают материалы и сдвигают сидовую запись на другую страницу.
    await author.page.goto("/authoring/materials");
    await author.page
      .getByRole("searchbox", {
        name: "Поиск по названию, описанию или адресу",
      })
      .fill(publishedMaterial.title);
    await expect(
      author.page
        .getByRole("region", { name: "Список материалов" })
        .getByText(publishedMaterial.title, { exact: true })
        // The list renders a table and a phone list; CSS shows one of them.
        .filter({ visible: true }),
    ).toBeVisible();
    expect((await authoringMaterial(author.page)).publicationState).toBe(
      "published",
    );

    const before = await seededOffer(observer.page);
    expect(await renameSeededOffer(author.page, before)).toEqual(billingDenial);
    expect(await peopleRead(author.page, "/api/authoring/people")).toEqual(
      peopleDenial,
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
    await billingManager.page.goto("/authoring/sales/payments");
    await expect(
      billingManager.page.getByRole("heading", {
        level: 1,
        name: "Платежи",
        exact: true,
      }),
    ).toBeVisible();
    expect((await seededOffer(billingManager.page)).product.id).toBe(
      productA.id,
    );

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
  const recipient = await accountIdOf(learner.page);
  const pair = { accountId: recipient, productId: productA.id };
  const revoke = async (current: z.infer<typeof accessSchema>) =>
    accessResult.parse(
      await access(billingManager.page, "revoke", {
        ...pair,
        operationId: crypto.randomUUID(),
        expectedRevision: current.revision,
        reason: "Scoped learner access check revoked",
      }),
    ).value.value;
  let activeAccess: z.infer<typeof accessSchema> | undefined;
  try {
    // Без назначения Product A закрыт, а бесплатный материал открыт: доступ к A даст только
    // назначение ниже, и отказ здесь не следствие сломанной сессии.
    await openMaterial(learner.page, publishedMaterial.slug, "available");
    await openDeniedBody(
      learner.page,
      productA.closedSlug,
      productA.closedBody,
    );

    const issued = accessResult.parse(
      await access(billingManager.page, "issue", {
        ...pair,
        sourceRef: `access-identities-${crypto.randomUUID()}`,
        reason: "Scoped learner access check",
      }),
    ).value.value;
    const assigned =
      issued.access === "revoked"
        ? accessResult.parse(
            await access(billingManager.page, "restore", {
              ...pair,
              operationId: crypto.randomUUID(),
              expectedRevision: issued.revision,
              reason: "Explicit owner restoration for isolated synthetic run",
            }),
          ).value.value
        : issued;
    activeAccess = assigned;
    expect(assigned.access).toBe("active");

    await openClosedBody(
      learner.page,
      productA.closedSlug,
      productA.closedBody,
    );
    await openDeniedBody(learner.page, productBSlug, productB.closedBody);

    const revoked = await revoke(assigned);
    expect(revoked.access).toBe("revoked");
    activeAccess = undefined;

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
      if (activeAccess !== undefined)
        expect((await revoke(activeAccess)).access).toBe("revoked");
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
      const response = await fullStackBrowserJsonRequest(page, path, "POST", {
        materialIds: [materialId],
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
      const response = await fullStackBrowserJsonRequest(
        page,
        "/api/bookmarks/state",
        "PUT",
        { materialId, bookmarked },
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({
        kind: "ready",
        state: { materialId, bookmarked },
      });
    };
    const setRead = async (page: Page, isRead: boolean) => {
      const version = (await reading(page))[0]?.version ?? 0;
      const response = await fullStackBrowserJsonRequest(
        page,
        "/api/reading-progress/state",
        "PUT",
        {
          materialId,
          commandId: crypto.randomUUID(),
          expectedVersion: version,
          isRead,
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
    // Account ID принимают только маршруты людей и Billing, и они требуют `billing:manage`.
    expect(
      await peopleRead(
        stranger.page,
        `/api/authoring/people/${ownerAccountId}`,
      ),
    ).toEqual(peopleDenial);
    expect(
      await peopleRead(
        stranger.page,
        `/api/authoring/people?query=${ownerAccountId}`,
      ),
    ).toEqual(peopleDenial);

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
      const action = viewer
        .getByRole("navigation", { name: "Действия материала", exact: true })
        .locator("[data-reading-action-state]:visible");
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
