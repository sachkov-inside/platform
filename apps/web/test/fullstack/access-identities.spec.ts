import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

import {
  fullStackBaseUrl,
  fullStackBrowserRequest,
  signInFullStack,
  type FullStackRole,
} from "../support/full-stack-session";

/**
 * Права через настоящий Web/BFF отдельными identities (#904). У каждой identity одно основание,
 * поэтому отказ доказывает границу права, а не отсутствие сессии. Каждый отказ стоит рядом с
 * разрешённой соседней возможностью того же Account, а запрещённый write — валидный запрос к
 * существующему ресурсу, после которого наблюдатель с правом читает то же состояние.
 */

/** Guide A — сидовый продукт «Создание Platform Inside» с закрытым материалом. */
const guideA = {
  id: "72000000-0000-4000-8000-000000000007",
  closedSlug: "developer-pipeline-bez-poteri-konteksta",
  closedBody: "Закрытое содержимое для участников.",
} as const;
/** Guide B — изолированный «Synthetic practice», который запускатор создаёт для прогона. */
const guideB = {
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
const enrollmentSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    result: z.object({
      value: z.object({
        id: z.string(),
        revision: z.number(),
        state: z.string(),
      }),
    }),
  }),
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

interface SignedIn {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** Отдельный browser context под своей identity; страница уже стоит на origin приложения. */
async function openAs(browser: Browser, role: FullStackRole) {
  const context = await browser.newContext({ baseURL: fullStackBaseUrl() });
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
    value: {
      id: seededOfferId,
      name: "Переименовано без права",
      benefits: ["materials"],
      availableForAssignment: true,
      contentScope: { guideIds: [guideA.id], materialIds: [] },
    },
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

async function closedBodyIsAbsent(page: Page, slug: string, body: string) {
  await page.goto(`/materials/${slug}`);
  await expect(
    page.locator('[data-material-reader-state="access-required"]'),
  ).toBeVisible();
  expect(await page.content()).not.toContain(body);
  // Повторный запрос из браузера идёт через его HTTP-кэш: прежний ответ не должен вернуть тело.
  const html = await page.evaluate(
    async (path) => (await fetch(path)).text(),
    `/materials/${slug}`,
  );
  expect(html).not.toContain(body);
}

async function closedBodyIsShown(page: Page, slug: string, body: string) {
  await page.goto(`/materials/${slug}`);
  await expect(
    page.locator('[data-material-reader-state="available"]'),
  ).toBeVisible();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
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
}) => {
  const billingManager = await openAs(browser, "BILLING_ONLY");
  const observer = await openAs(browser, "MATERIALS_ONLY");
  try {
    await billingManager.page.goto("/authoring/billing");
    await expect(
      billingManager.page
        .getByText("Материалы + сопровождение", { exact: true })
        .first(),
    ).toBeVisible();
    expect((await seededOffer(billingManager.page)).name).toBe("Материалы");

    const before = await authoringMaterial(observer.page);
    expect(await unpublishMaterial(billingManager.page, before)).toEqual(
      materialsDenial,
    );
    const listed = await fullStackBrowserRequest(
      billingManager.page,
      "/api/authoring/materials",
    );
    expect(await listed.json()).toEqual(materialsDenial);
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
    await reader.page.goto(`/materials/${publishedMaterial.slug}`);
    await expect(
      reader.page.locator('[data-material-reader-state="available"]'),
    ).toBeVisible();

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

test("a learner scoped to Guide A reads Guide A, is denied Guide B and loses Guide A on revocation", async ({
  browser,
}) => {
  const guideBSlug = process.env["FULLSTACK_PRACTICE_SLUG"];
  if (guideBSlug === undefined)
    throw new Error("Missing Guide B fixture (FULLSTACK_PRACTICE_SLUG)");
  const learner = await openAs(browser, "GUIDE_A_LEARNER");
  const billingManager = await openAs(browser, "BILLING_ONLY");
  try {
    // Без назначения закрыты оба Guide: дальнейший доступ к A даёт только это назначение.
    await closedBodyIsAbsent(
      learner.page,
      guideA.closedSlug,
      guideA.closedBody,
    );

    const tierId = crypto.randomUUID();
    expect(
      await billing(billingManager.page, "offers/save", {
        value: {
          id: tierId,
          name: `Только Guide A ${tierId}`,
          benefits: ["materials"],
          availableForAssignment: true,
          contentScope: { guideIds: [guideA.id], materialIds: [] },
        },
      }),
    ).toMatchObject({ ok: true });
    const terms = {
      startsAt: new Date().toISOString(),
      endsAt: null,
      endPolicy: "fixed",
    };
    const assigned = enrollmentSchema.parse(
      await billing(billingManager.page, "enrollments/assign", {
        accountId: await accountIdOf(learner.page),
        origin: "manual",
        sourceRef: `access-identities-${tierId}`,
        tierId,
        tierRevision: 1,
        terms,
        billingRef: null,
        reason: "Scoped learner access check",
      }),
    ).value.result.value;
    expect(assigned.state).toBe("active");

    await closedBodyIsShown(learner.page, guideA.closedSlug, guideA.closedBody);
    await closedBodyIsAbsent(learner.page, guideBSlug, guideB.closedBody);

    const revoked = enrollmentSchema.parse(
      await billing(billingManager.page, "enrollments/change", {
        enrollmentId: assigned.id,
        expectedRevision: assigned.revision,
        action: "revoke",
        terms,
        reason: "Scoped learner access check revoked",
      }),
    ).value.result.value;
    expect(revoked.state).toBe("revoked");

    // Страница с телом уже была открыта этим браузером; следующий запрос получает отказ.
    await closedBodyIsAbsent(
      learner.page,
      guideA.closedSlug,
      guideA.closedBody,
    );
    // Бесплатный материал остаётся открытым: отказ выше не следствие сломанной сессии.
    await learner.page.goto(`/materials/${publishedMaterial.slug}`);
    await expect(
      learner.page.locator('[data-material-reader-state="available"]'),
    ).toBeVisible();
  } finally {
    await learner.context.close();
    await billingManager.context.close();
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

    await owner.page.goto(`/materials/${publishedMaterial.slug}`);
    const materialId = await owner.page
      .locator('[data-material-reader-state="available"]')
      .getAttribute("data-material-id");
    if (materialId === null) throw new Error("Reader has no Material ID");

    const bookmarks = (page: Page) =>
      fullStackBrowserRequest(page, "/api/bookmarks/states", "POST", {
        materialId,
      }).then(
        async (response) =>
          bookmarkStatesSchema.parse(await response.json()).states,
      );
    const reading = (page: Page) =>
      fullStackBrowserRequest(page, "/api/reading-progress/states", "POST", {
        materialId,
      }).then(
        async (response) =>
          readingStatesSchema.parse(await response.json()).states,
      );

    expect(
      await (
        await fullStackBrowserRequest(
          owner.page,
          "/api/bookmarks/state",
          "PUT",
          {
            materialId,
            bookmarked: "true",
          },
        )
      ).json(),
    ).toMatchObject({ kind: "ready", state: { bookmarked: true } });
    const ownerVersion = (await reading(owner.page))[0]?.version ?? 0;
    expect(
      await (
        await fullStackBrowserRequest(
          owner.page,
          "/api/reading-progress/state",
          "PUT",
          {
            materialId,
            commandId: crypto.randomUUID(),
            expectedVersion: String(ownerVersion),
            isRead: "true",
          },
        )
      ).json(),
    ).toMatchObject({ kind: "saved", state: { isRead: true } });
    const ownerReading = await reading(owner.page);

    // Чужой Account не видит отметок владельца ни в состояниях, ни в списке закладок.
    expect(await bookmarks(stranger.page)).toEqual([
      expect.objectContaining({ materialId, bookmarked: false }),
    ]);
    expect(await reading(stranger.page)).toEqual([
      expect.objectContaining({ materialId, isRead: false }),
    ]);
    const strangerList = await fullStackBrowserRequest(
      stranger.page,
      "/api/bookmarks",
    );
    expect(strangerList.status()).toBe(200);
    expect(
      z
        .object({ items: z.array(z.object({ id: z.string() }).loose()) })
        .parse(await strangerList.json())
        .items.map(({ id }) => id),
    ).not.toContain(materialId);

    // Подставленный ID владельца и его версия не меняют чужие отметки: команда относится к
    // Account сессии, а не к полю запроса.
    await fullStackBrowserRequest(
      stranger.page,
      "/api/bookmarks/state",
      "PUT",
      {
        materialId,
        bookmarked: "false",
        accountId: ownerAccountId,
      },
    );
    await fullStackBrowserRequest(
      stranger.page,
      "/api/reading-progress/state",
      "PUT",
      {
        materialId,
        commandId: crypto.randomUUID(),
        expectedVersion: String(ownerReading[0]?.version ?? 0),
        isRead: "false",
        accountId: ownerAccountId,
      },
    );
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
