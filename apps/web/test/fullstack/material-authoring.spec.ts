import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

const currentMaterialEditorUrl = /\/authoring\/materials\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\?.*)?$/u;

test("uploads, resumes and replaces one primary Video while keeping provider bytes behind authorization", async ({
  context,
  page,
  request,
}, testInfo) => {
  const suffix = String(Date.now());
  const title = `Video flow ${suffix}`;
  const slug = `video-flow-${suffix}`;
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    const hostname = new URL(request.url()).hostname;
    if (hostname.endsWith("kinescope.io")) providerRequests.push(request.url());
  });

  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  const visibleEditor = page.locator("main[data-material-authoring='true']:visible");
  await expect(visibleEditor).toBeVisible({ timeout: 15_000 });
  const editorUrl = page.url();

  await visibleEditor.getByLabel("Видео для загрузки").setInputFiles({
    buffer: Buffer.from("Full-stack test Video\n"),
    mimeType: "video/mp4",
    name: `test-video-${suffix}.mp4`,
  });
  await expect(page.getByText("Kinescope обрабатывает видео")).toBeVisible();
  await expect(page.getByText("Готово к Save")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });

  const readerResponse = await page.goto(`/materials/${slug}`);
  expect(readerResponse?.headers()["content-security-policy"]).toContain("frame-src https://kinescope.io");
  expect(readerResponse?.headers()["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline' https://player.kinescope.io");
  await expect(page.getByRole("region", { name: "Видео" })).toBeVisible();
  await expect(page.locator("p:visible", { hasText: `test-video-${suffix}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Загрузить видео" })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(providerRequests).toEqual([]);

  const materialId = await page.getByRole("button", { name: "Загрузить видео" }).evaluate((button) =>
    button.closest("main")?.querySelector<HTMLElement>("[data-material-id]")?.dataset.materialId ?? null,
  );
  const videoId = await page.getByRole("button", { name: "Загрузить видео" }).evaluate((button) =>
    button.closest("section")?.getAttribute("data-video-id"),
  );
  if (typeof materialId !== "string" || typeof videoId !== "string") {
    throw new Error("Video identity evidence is missing");
  }
  const session = await page.request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId },
  });
  expect(session.status()).toBe(200);
  await expect(session.json()).resolves.toMatchObject({
    drmAuthToken: null,
    progressScope: "account",
    videoId,
  });
  const anonymousSession = await request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId },
  });
  expect(anonymousSession.status()).toBe(200);
  await expect(anonymousSession.json()).resolves.toMatchObject({
    drmAuthToken: null,
    progressScope: "anonymous",
    resumeSeconds: null,
    videoId,
  });

  const progress = await page.request.put("/api/material-video-progress", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { durationSeconds: "120", materialId, positionSeconds: "37", videoId },
  });
  expect(progress.status()).toBe(200);
  await expect(progress.json()).resolves.toEqual({ kind: "saved" });
  const resumedSession = await page.request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId },
  });
  expect(resumedSession.status()).toBe(200);
  await expect(resumedSession.json()).resolves.toMatchObject({
    progressScope: "account",
    resumeSeconds: 37,
    videoId,
  });
  await captureVideoEvidence(page, testInfo, "reader-privacy-facade");

  await page.goto(editorUrl);
  await page.getByLabel(/ID существующего видео/u).fill(`test-outage-once-${suffix}`);
  await page.getByRole("button", { name: "Привязать" }).click();
  await expect(page.getByText("Нужна повторная попытка")).toBeVisible();
  await page.getByRole("button", { name: "Привязать" }).click();
  await expect(page.getByText("Готово к Save")).toBeVisible();
  const preSaveSession = await page.request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId },
  });
  expect(preSaveSession.status()).toBe(200);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await page.goto(`/materials/${slug}`);
  const replacementVideoId = await page.getByRole("button", { name: "Загрузить видео" }).evaluate((button) =>
    button.closest("section")?.getAttribute("data-video-id"),
  );
  if (typeof replacementVideoId !== "string") {
    throw new Error("Replacement Video identity is missing");
  }
  expect(replacementVideoId).not.toBe(videoId);
  const staleSession = await page.request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId },
  });
  expect(staleSession.status()).toBe(403);
  const replacementSession = await page.request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId: replacementVideoId },
  });
  expect(replacementSession.status()).toBe(200);
  await expect(replacementSession.json()).resolves.toMatchObject({ videoId: replacementVideoId });

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("explicitly requests deletion of a Platform-uploaded Video only with the successful Material Save", async ({
  context,
  page,
}, testInfo) => {
  const suffix = String(Date.now());
  const title = `Safe Video deletion ${suffix}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(page.locator("main[data-material-authoring='true']:visible")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Видео для загрузки").setInputFiles({
    buffer: Buffer.from("Full-stack deletion test Video\n"),
    mimeType: "video/mp4",
    name: `delete-me-${suffix}.mp4`,
  });
  await expect(page.getByText("Готово к Save")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Убрать и удалить из Kinescope…" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Удалить «delete-me-${suffix}» из Kinescope?`,
  });
  await expect(dialog).toBeVisible();
  await captureVideoDeletionEvidence(page, testInfo, "confirmation");
  await dialog.getByRole("button", { name: "Убрать и удалить из Kinescope" }).click();

  await expect(page.getByText(`Удаление «delete-me-${suffix}» будет запрошено только после Save.`))
    .toBeVisible();
  await expect(page.getByText("Основное видео не выбрано")).toBeVisible();
  await captureVideoDeletionEvidence(page, testInfo, "pending-save");

  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Удаление «delete-me-${suffix}» запрошено.`)).toBeVisible();
  await captureVideoDeletionEvidence(page, testInfo, "requested");
});

test("member primary Video denies anonymous playback and issues a DRM proof to an authorized Account", async ({
  context,
  page,
  request,
}) => {
  const suffix = String(Date.now());
  const title = `Member Video ${suffix}`;
  const slug = `member-video-${suffix}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("combobox", { name: "Доступ" }).click();
  await page.getByRole("option", { name: "Для участников" }).click();
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.getByLabel(/ID существующего видео/u).fill(`member-provider-${suffix}`);
  await page.getByRole("button", { name: "Привязать" }).click();
  await expect(page.getByText("Готово к Save")).toBeVisible();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });

  await page.goto(`/materials/${slug}`);
  const videoSection = page.locator("section[data-video-id]");
  const materialId = await page.locator("[data-material-reader-state][data-material-id]")
    .getAttribute("data-material-id");
  const videoId = await videoSection.getAttribute("data-video-id");
  if (materialId === null || videoId === null) throw new Error("Member Video identity is missing");
  const anonymousSession = await request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId },
  });
  expect(anonymousSession.status()).toBe(403);
  await addFullStackMemberSession(context);
  const memberSession = await page.request.post("/api/material-video-playback-sessions", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { materialId, videoId },
  });
  expect(memberSession.status()).toBe(200);
  const memberBody = await memberSession.json() as {
    readonly drmAuthToken?: unknown;
    readonly progressScope?: unknown;
    readonly videoId?: unknown;
  };
  expect(memberBody).toMatchObject({ progressScope: "account", videoId });
  expect(memberBody.drmAuthToken).toEqual(expect.any(String));

  await addFullStackSession(context);
  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("trusted author uploads chooser, paste and drop assets through Preview and public Reader", async ({
  context,
  page,
  request,
}, testInfo) => {
  const suffix = String(Date.now());
  const title = `Asset flow ${suffix}`;
  const slug = `asset-flow-${suffix}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.getByLabel("Выбрать файлы").setInputFiles({
    buffer: Buffer.from("Chooser attachment\n"),
    mimeType: "text/plain",
    name: "chooser.txt",
  });
  await dispatchFileEvent(page, "paste", {
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    mimeType: "image/png",
    name: "diagram.png",
  });
  await dispatchFileEvent(page, "drop", {
    base64: Buffer.from("Dropped attachment\n").toString("base64"),
    mimeType: "text/plain",
    name: "dropped.txt",
  });

  const chooser = page.getByRole("listitem").filter({ hasText: "chooser.txt" });
  const diagram = page.getByRole("listitem").filter({ hasText: "diagram.png" });
  const dropped = page.getByRole("listitem").filter({ hasText: "dropped.txt" });
  await expect(chooser.getByText("Готово к вставке")).toBeVisible({ timeout: 30_000 });
  await expect(diagram.getByText("Готово к вставке")).toBeVisible({ timeout: 30_000 });
  await expect(dropped.getByText("Готово к вставке")).toBeVisible({ timeout: 30_000 });
  const uploadAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(uploadAccessibility.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  )).toEqual([]);
  await captureAssetEvidence(page, testInfo, "editor-ready");
  await insertReadyAsset(chooser);
  await diagram.getByLabel("Описание изображения").fill("Схема asset flow");
  await insertReadyAsset(diagram);
  await insertReadyAsset(dropped);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(page.getByRole("img", { name: "Схема asset flow" })).toBeVisible();
  await expect(page.getByRole("link", { name: /chooser.txt/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /dropped.txt/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ресурсы" })).toHaveCount(0);

  await page.getByRole("link", { name: "Вернуться в редактор" }).last().click();
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await page.goto(`/materials/${slug}`);
  await expect(page.getByRole("img", { name: "Схема asset flow" })).toBeVisible();
  const fileLink = page.getByRole("link", { name: /chooser.txt/u });
  await expect(fileLink).toBeVisible();
  const readerAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(readerAccessibility.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  )).toEqual([]);
  await captureAssetEvidence(page, testInfo, "reader-inline-assets");
  const fileResponse = await request.get(await fileLink.getAttribute("href") ?? "");
  expect(fileResponse.status()).toBe(200);
  expect(fileResponse.headers()["cache-control"]).toContain("immutable");
  expect(fileResponse.headers()["content-disposition"]).toContain("attachment");
  expect(fileResponse.headers()["x-content-type-options"]).toBe("nosniff");

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const publishedRow = page.getByRole("listitem").filter({ hasText: title });
  await publishedRow.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(publishedRow.getByText("Снят с публикации", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test("member Material hides bytes from anonymous access and issues only a protected redirect", async ({
  context,
  page,
  request,
}) => {
  const suffix = String(Date.now());
  const title = `Member asset ${suffix}`;
  const slug = `member-asset-${suffix}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("combobox", { name: "Доступ" }).click();
  await page.getByRole("option", { name: "Для участников" }).click();
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.getByLabel("Выбрать файлы").setInputFiles({
    buffer: Buffer.from("Protected member attachment\n"),
    mimeType: "text/plain",
    name: "member-guide.txt",
  });
  const upload = page.getByRole("listitem").filter({ hasText: "member-guide.txt" });
  await expect(upload.getByText("Готово к вставке")).toBeVisible({ timeout: 30_000 });
  await upload.getByRole("button", { name: "Вставить" }).click();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });

  await page.goto(`/materials/${slug}`);
  const fileLink = page.getByRole("link", { name: /member-guide.txt/u });
  await expect(fileLink).toBeVisible();
  const href = await fileLink.getAttribute("href");
  if (href === null) throw new Error("member file link is missing");
  const anonymous = await request.get(href, { maxRedirects: 0 });
  expect(anonymous.status()).toBe(404);
  expect(anonymous.headers()["cache-control"]).toContain("no-store");
  const manager = await page.request.get(href, { maxRedirects: 0 });
  expect(manager.status()).toBe(302);
  expect(manager.headers()["cache-control"]).toBe("private, no-store");
  const location = manager.headers().location;
  expect(location).toContain("X-Amz-Expires=60");

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("trusted author creates a PostgreSQL draft and opens its current Preview", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await completeProfileOnboardingIfPresent(page);
  await expect(page.getByRole("heading", { name: "Новый материал" })).toBeVisible();
  await expect(page.getByLabel("Адрес")).toHaveCount(0);

  await page.getByRole("button", { name: "Вернуться к материалам" }).focus();
  await expect(page.getByRole("button", { name: "Вернуться к материалам" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Название")).toBeFocused();

  await page.getByLabel("Название").fill("Current Preview без fake data");
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page.getByText("Укажите краткое описание до 500 символов.")).toBeVisible();
  await expect(page.getByText("Черновик создан")).toHaveCount(0);

  await page
    .getByLabel("Краткое описание")
    .fill("Черновик проходит Next mutation boundary и сохраняется через Nest MaterialAuthoring.");
  await page.getByRole("combobox", { name: "Тема" }).click();
  await page.getByRole("option", { name: "Платформа" }).click();
  await page.getByRole("combobox", { name: "Формат" }).click();
  await page.getByRole("option", { name: "Гайд" }).click();
  await page.getByText("Full stack", { exact: true }).click();
  await page.getByText("Создание Platform Inside", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Содержимое материала" })
    .fill("Текущее сохранённое содержимое из PostgreSQL.");

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(page.getByLabel("Адрес")).toHaveCount(0);
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Версия", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Предпросмотр" })).toBeEnabled();

  await page.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(page).toHaveURL(new RegExp(`/authoring/materials/.+/preview(?:\\?.*)?$`, "u"));
  await expect(page.getByRole("heading", { name: "Предпросмотр материала" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Current Preview без fake data", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Текущее сохранённое содержимое из PostgreSQL.")).toBeVisible();
  await expect(page.getByText("Гайд")).toBeVisible();
  await expect(page.getByText("Платформа")).toBeVisible();
  await expect(page.getByText("Full stack")).toBeVisible();
  await expect(page.getByText("Сохранённый черновик. Материал ещё не опубликован.")).toBeVisible();
});

test("trusted author finds every Material and returns from Editor to the same list query", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const listUrl =
    "/authoring/materials?search=%D0%9A%D0%B0%D0%BA+%D1%83%D1%81%D1%82%D1%80%D0%BE%D0%B5%D0%BD&state=published";
  const response = await page.goto(listUrl);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Материалы", level: 1 })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Редактор" })
      .getByRole("link", { name: "Новый материал" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Как устроен Inside Platform" })).toBeVisible();
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Версия", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Topic", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Format", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Платформа", { exact: true })).toBeVisible();
  await expect(page.getByText("Гайд", { exact: true })).toBeVisible();
  await expect(page.getByText(/Все текущие Materials/u)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Состояние публикации" }),
  ).toContainText("Опубликованные");
  const searchbox = page.getByRole("searchbox", {
    name: "Поиск по названию, описанию или адресу",
  });
  await searchbox.focus();
  await expect(
    searchbox,
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Состояние публикации" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Показать" })).toHaveCount(0);
  await searchbox.fill("Developer Pipeline");
  await expect(page.getByRole("link", { name: /Developer Pipeline/u }).first()).toBeVisible();
  await expect(page).toHaveURL(/search=Developer\+Pipeline&state=published/u);
  await searchbox.fill("Как устроен");
  await expect(page.getByRole("link", { name: "Как устроен Inside Platform" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await page.getByRole("link", { name: "Предпросмотр" }).click();
  await expect(page.getByRole("heading", { name: "Предпросмотр материала" })).toBeVisible();
  await expect(page.getByText("Reader verification checklist")).toBeVisible();
  await page.getByRole("link", { name: "К материалам" }).click();
  await expect(page).toHaveURL(listUrl);

  await page.getByRole("link", { name: "Редактировать" }).click();
  await expect(page.getByRole("heading", { name: "Как устроен Inside Platform" })).toBeVisible();
  await page.getByRole("button", { name: "Вернуться к материалам" }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByRole("link", { name: "Как устроен Inside Platform" })).toBeVisible();

  await page
    .getByRole("main")
    .getByRole("link", { name: "Новый материал" })
    .click();
  await expect(page.getByRole("heading", { name: "Новый материал" })).toBeVisible();
  await page.getByRole("button", { name: "Вернуться к материалам" }).click();
  await expect(page).toHaveURL(listUrl);
});

test("full-state Save is live and a stale editor preserves local input through lifecycle changes", async ({
  context,
  page,
}) => {
  const uniqueSuffix = String(Date.now());
  const initialTitle = `Mutable Material ${uniqueSuffix}`;
  const winnerTitle = `Mutable Material winner ${uniqueSuffix}`;
  const slug = `mutable-material-winner-${uniqueSuffix}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, initialTitle);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(page.getByRole("button", { name: "Предпросмотр" })).toBeEnabled();
  const editorUrl = page.url();
  const stalePage = await context.newPage();
  await stalePage.goto(editorUrl);
  await expect(stalePage.getByRole("heading", { name: initialTitle })).toBeVisible();
  await expect(stalePage.getByText(/^v\d+$/u)).toHaveCount(0);

  await page.getByLabel("Название").fill(winnerTitle);
  await page.getByLabel("Название").press("Enter");
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();

  const localSummary = "Локальный ввод stale editor должен остаться на месте.";
  await stalePage.getByLabel("Краткое описание").fill(localSummary);
  await stalePage.getByRole("button", { name: "Сохранить" }).click();
  await expect(stalePage.getByRole("main").getByRole("alert")).toContainText(
    "Материал изменился в другой сессии",
  );
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  const currentPreviewPromise = context.waitForEvent("page");
  await stalePage.getByRole("button", { name: "Сравнить" }).click();
  const currentPreview = await currentPreviewPromise;
  await currentPreview.waitForLoadState();
  await expect(
    currentPreview.getByRole("heading", { name: winnerTitle, level: 1 }),
  ).toBeVisible();
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  const currentEditorPromise = context.waitForEvent("page");
  await stalePage.getByRole("button", { name: "Открыть текущую" }).click();
  const currentEditor = await currentEditorPromise;
  await currentEditor.waitForLoadState();
  await expect(currentEditor.getByLabel("Название")).toHaveValue(
    winnerTitle,
  );
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(localSummary);

  await expect(page.getByLabel("Адрес")).toHaveCount(0);
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Опубликован", { exact: true }).first()).toBeVisible();

  const publicPage = await context.newPage();
  await publicPage.goto(`/materials/${slug}`);
  await expect(
    publicPage.getByRole("heading", { name: winnerTitle, level: 1 }),
  ).toBeVisible();
  await expect(publicPage.getByText("Текущее сохранённое содержимое из PostgreSQL.")).toBeVisible();

  await page.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(page.getByText("Материал сохранён")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { name: "Материал не найден" })).toBeVisible();
});

test("trusted author publishes and unpublishes the same full state from the Materials list", async ({
  context,
  page,
}, testInfo) => {
  const title = `Lifecycle из списка ${String(Date.now())}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("Черновик", { exact: true })).toBeVisible();
  const deleteButton = row.getByRole("button", { name: "Удалить черновик" });
  await expect(deleteButton).toBeVisible();
  await captureLifecycleEvidence(page, testInfo, "live-lifecycle");
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", { name: `Удалить «${title}»?` });
  await expect(deleteDialog).toBeVisible();
  await captureLifecycleEvidence(page, testInfo, "live-delete-confirmation");
  await deleteDialog.getByRole("button", { name: "Оставить черновик" }).click();
  await expect(deleteDialog).toBeHidden();

  await row.getByRole("button", { name: "Опубликовать" }).click();
  await expect(row.getByText("Опубликован", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(row.getByRole("button", { name: "Снять с публикации" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Удалить черновик" })).toHaveCount(0);

  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(row.getByRole("button", { name: "Опубликовать" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Удалить черновик" })).toHaveCount(0);
});

test("trusted author cancels and confirms deletion of a never-published draft", async ({
  context,
  page,
}) => {
  const title = `Удаляемый черновик ${String(Date.now())}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  const openDelete = page.getByRole("button", { name: "Удалить черновик" });
  await openDelete.focus();
  await expect(openDelete).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Удалить «${title}»?` });
  await expect(dialog).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await openDelete.click();
  await dialog.getByRole("button", { name: "Оставить черновик" }).click();
  await expect(dialog).toBeHidden();

  await openDelete.click();
  await dialog.getByRole("button", { name: "Удалить безвозвратно" }).click();
  await expect(page).toHaveURL(/\/authoring\/materials(?:\?.*)?$/u);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});

test("trusted author sees a typed not-found state for a missing current Preview", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto(
    "/authoring/materials/94000000-0000-4000-8000-000000000099/preview",
  );
  await completeProfileOnboardingIfPresent(page);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Предпросмотр не найден" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Повторить" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Вернуться в редактор" })).toBeVisible();
});

test("trusted author reorders a PostgreSQL series with keyboard controls", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto("/authoring/playlists");
  expect(response?.status()).toBe(200);
  await page.getByRole("link", { name: "Состав" }).click();
  await expect(page).toHaveURL(/\/authoring\/playlists\/[0-9a-f-]+$/u);
  await expect(
    page.getByRole("heading", { name: "Создание Platform Inside", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Добавить материал" }).click();
  const picker = page.getByRole("dialog", { name: "Добавить материал" });
  await expect(picker).toBeVisible();
  await expect(picker.getByText("Результаты появятся после ввода запроса.")).toBeVisible();
  await picker
    .getByRole("searchbox", { name: "Поиск материала для добавления" })
    .fill("Lifecycle из списка");
  await expect(
    picker
      .getByRole("button", { name: /Добавить «Lifecycle из списка/u })
      .first(),
  ).toBeVisible();
  await picker.getByRole("button", { name: "Закрыть выбор материала" }).click();
  await expect(picker).toBeHidden();

  const items = page.getByRole("list", { name: "Материалы серии" }).getByRole("listitem");
  await expect(items.nth(1)).toBeVisible();
  const firstTitle = await items.first().locator("p").first().innerText();
  const secondTitle = await items.nth(1).locator("p").first().innerText();
  const moveDown = items.first().getByRole("button", {
    name: `Опустить «${firstTitle}»`,
  });
  await moveDown.focus();
  await expect(moveDown).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Есть несохранённые изменения.")).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await page.getByRole("button", { name: "Сохранить", exact: true }).first().click();
  await expect(page.getByText("Порядок сохранён.")).toBeVisible();
  await page.reload();
  await expect(items.first().locator("p").first()).toHaveText(secondTitle);
});

test("guest cannot reach the production Material editor", async ({ page }) => {
  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Нет доступа к редактору" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать черновик" })).toHaveCount(0);
});

test("guest cannot reach the production playlist manager", async ({ page }) => {
  const response = await page.goto("/authoring/playlists");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Нет доступа к редактору" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toHaveCount(0);
});

async function addFullStackSession(context: BrowserContext) {
  await addSessionCookie(context, "FULLSTACK_LOGTO_SESSION");
}

async function addFullStackMemberSession(context: BrowserContext) {
  await addSessionCookie(context, "FULLSTACK_LOGTO_MEMBER_SESSION");
}

async function addSessionCookie(
  context: BrowserContext,
  environmentName: "FULLSTACK_LOGTO_MEMBER_SESSION" | "FULLSTACK_LOGTO_SESSION",
) {
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const session = process.env[environmentName];
  if (cookieName === undefined || session === undefined) {
    throw new Error("Full-stack Logto session fixture is missing");
  }
  await context.addCookies([
    {
      httpOnly: true,
      name: cookieName,
      sameSite: "Lax",
      url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000",
      value: session,
    },
  ]);
}

async function completeProfileOnboardingIfPresent(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Как к вам обращаться?" });
  const visible = await dialog
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await dialog.getByLabel("Имя").fill("Full-stack author");
  await dialog.getByRole("button", { name: "Продолжить" }).click();
  await expect(dialog).toBeHidden();
}

async function fillPublishableDraft(page: Page, title: string) {
  await page.getByLabel("Название").fill(title);
  await page
    .getByLabel("Краткое описание")
    .fill("Full-state Save проходит через production Editor и Nest MaterialAuthoring.");
  await page.getByRole("combobox", { name: "Тема" }).click();
  await page.getByRole("option", { name: "Платформа" }).click();
  await page.getByRole("combobox", { name: "Формат" }).click();
  await page.getByRole("option", { name: "Гайд" }).click();
  await page
    .getByRole("textbox", { name: "Содержимое материала" })
    .fill("Текущее сохранённое содержимое из PostgreSQL.");
}

async function dispatchFileEvent(
  page: Page,
  eventType: "drop" | "paste",
  file: { readonly base64: string; readonly mimeType: string; readonly name: string },
): Promise<void> {
  await page.locator("#material-body").evaluate((element, input) => {
    const bytes = Uint8Array.from(atob(input.file.base64), (character) =>
      character.charCodeAt(0),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], input.file.name, { type: input.file.mimeType }));
    const event = input.eventType === "paste"
      ? new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer })
      : new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
    element.dispatchEvent(event);
  }, { eventType, file });
}

async function insertReadyAsset(upload: Locator) {
  const insert = upload.getByRole("button", { name: "Вставить" });
  await expect(insert).toBeEnabled();
  await insert.dispatchEvent("click");
}

async function captureLifecycleEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-150",
  );
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport =
    testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}

async function captureAssetEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(process.cwd(), "../../docs/evidence/issue-180");
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport = testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}

async function captureVideoEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(process.cwd(), "../../docs/evidence/issue-183");
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport = testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}

async function captureVideoDeletionEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(process.cwd(), "../../docs/evidence/issue-227");
  await mkdir(evidenceDirectory, { recursive: true });
  const viewport = testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: resolve(evidenceDirectory, `${name}-${viewport}.png`),
  });
}
