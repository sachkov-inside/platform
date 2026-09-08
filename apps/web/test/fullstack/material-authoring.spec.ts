import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

const currentMaterialEditorUrl =
  /\/authoring\/materials\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\?.*)?$/u;

for (const access of ["public", "membership"] as const) {
  test(`media convergence: ${access} Material composes image, file and primary Video across Subjects`, async ({
    browser,
    context,
    page,
    request,
  }, testInfo) => {
    const suffix = String(Date.now());
    const title = `Media acceptance ${access} ${suffix}`;
    const slug = `media-acceptance-${access}-${suffix}`;
    await addFullStackSession(context);
    await installPlaybackProviderDouble(page);
    await page.addLocatorHandler(
      page.getByRole("dialog", { name: "Подключите Telegram" }),
      async (dialog) => {
        await dialog
          .getByRole("button", { name: "Закрыть подключение Telegram" })
          .click();
      },
    );
    await page.goto("/authoring/materials/new");
    await completeProfileOnboardingIfPresent(page);
    await fillPublishableDraft(page, title);
    if (access === "membership") {
      await page.getByRole("combobox", { name: "Доступ" }).click();
      await page.getByRole("option", { name: "Для участников" }).click();
    }
    await expect(page).toHaveURL(currentMaterialEditorUrl);
    await waitMaterialSaved(page);
    await expect(page).toHaveURL(currentMaterialEditorUrl);
    await page.getByLabel("Выбрать файлы").setInputFiles({
      buffer: Buffer.from("Media convergence attachment\n"),
      mimeType: "text/plain",
      name: "media-proof.txt",
    });
    await dispatchFileEvent(page, "paste", {
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      mimeType: "image/png",
      name: "media-proof.png",
    });
    const file = page
      .locator("[data-node-view-wrapper]")
      .filter({ has: page.locator('input[value="media-proof.txt"]') });
    const diagram = page
      .locator("[data-node-view-wrapper]")
      .filter({ has: page.locator("img") });
    await expect(file).toBeVisible({ timeout: 30_000 });
    await expect(diagram).toBeVisible({ timeout: 30_000 });

    await diagram
      .getByLabel("Описание изображения")
      .fill("Изображение общей приёмки");

    await page
      .getByText("Выбрать существующее видео Kinescope", { exact: true })
      .click();
    await page.getByLabel(/ID видео/u).fill(`media-proof-${access}-${suffix}`);
    await page.getByRole("button", { name: "Привязать" }).click();
    await expect(page.getByText("Видео готово")).toBeVisible();
    await expect(page.getByRole("button", { name: "Удалить…" })).toHaveCount(0);
    await waitMaterialSaved(page);
    await expect(
      page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Опубликовать" }).click();
    await expect(
      page.locator("header").getByText("Опубликован", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
    ).toBeVisible({ timeout: 15_000 });

    // The ordinary member has no author permission; exercise the same live resource after switching Subject.
    await addFullStackMemberSession(context);
    await page.goto(`/materials/${slug}`);
    const image = page.getByRole("img", { name: "Изображение общей приёмки" });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((element) =>
          element instanceof HTMLImageElement ? element.naturalWidth : 0,
        ),
      )
      .toBeGreaterThan(0);
    await expect(
      page.locator("[data-video-player-mount] iframe"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ресурсы" })).toHaveCount(0);
    const href = await page
      .getByRole("link", { name: /media-proof.txt/u })
      .getAttribute("href");
    // Next.js streaming retains hidden HTML outside the active main landmark.
    const materialId = await page
      .getByRole("main")
      .locator("[data-material-reader-state][data-material-id]")
      .getAttribute("data-material-id");
    const videoId = await page
      .getByRole("main")
      .locator("section[data-video-id]")
      .getAttribute("data-video-id");
    if (href === null || materialId === null || videoId === null)
      throw new Error("Media references are missing");
    const memberFile = await page.request.get(href);
    expect(memberFile.status()).toBe(200);
    expect(await memberFile.text()).toBe("Media convergence attachment\n");
    expect(memberFile.headers()["content-disposition"]).toContain("attachment");
    expect(memberFile.headers()["x-content-type-options"]).toBe("nosniff");
    const wrongMaterial = await page.request.post(
      "/api/material-video-playback-sessions",
      {
        headers: { origin: new URL(page.url()).origin },
        multipart: { materialId: crypto.randomUUID(), videoId },
      },
    );
    expect(wrongMaterial.status()).toBe(403);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      accessibility.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const evidenceDirectory = resolve(
      process.cwd(),
      "../../docs/evidence/issue-186",
    );
    await mkdir(evidenceDirectory, { recursive: true });
    const viewport =
      testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: resolve(evidenceDirectory, `${access}-${viewport}.png`),
    });

    const anonymousFile = await request.get(href, { maxRedirects: 0 });
    expect(anonymousFile.status()).toBe(access === "public" ? 200 : 404);
    const anonymousPlayback = await request.post(
      "/api/material-video-playback-sessions",
      {
        headers: { origin: new URL(page.url()).origin },
        multipart: { materialId, videoId },
      },
    );
    expect(anonymousPlayback.status()).toBe(access === "public" ? 200 : 403);
    const protectedImageSource = await image.getAttribute("src");
    if (protectedImageSource === null) throw new Error("Image URL is missing");
    if (access === "membership") {
      // A separate unrouted context keeps the real HTTP cache enabled; player doubles disable it.
      const cacheContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
      });
      try {
        await addFullStackMemberSession(cacheContext);
        const cachePage = await cacheContext.newPage();
        const allowed = await cachePage.goto(protectedImageSource);
        expect(allowed?.status()).toBe(200);
        expect(allowed?.headers()["content-type"]).toContain("image/");
        await cacheContext.clearCookies();
        const denied = await cachePage.goto(protectedImageSource);
        expect(denied?.status()).toBe(404);
        expect(denied?.headers()["cache-control"]).toContain("no-store");
      } finally {
        await cacheContext.close();
      }
    }
    // Reauthorize the same Reader after switching Subject; do not accept its loading skeleton as denial.
    await context.clearCookies();
    const protectedRequests: string[] = [];
    page.on("request", (outgoing) => {
      const url = new URL(outgoing.url());
      if (
        url.hostname.endsWith("kinescope.io") ||
        url.pathname.includes("/assets/") ||
        url.pathname.startsWith("/api/material-video")
      ) {
        protectedRequests.push(outgoing.url());
      }
    });
    await page.reload();
    if (access === "membership") {
      await expect(
        page
          .getByRole("main")
          .locator('[data-material-reader-state="access-required"]'),
      ).toBeVisible();
      await expect(image).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: /media-proof.txt/u }),
      ).toHaveCount(0);
      await expect(page.locator("iframe")).toHaveCount(0);
      expect(protectedRequests).toEqual([]);
      expect(anonymousFile.headers()["cache-control"]).toContain("no-store");
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: resolve(evidenceDirectory, `denied-${viewport}.png`),
      });
      for (const sessionName of [
        "FULLSTACK_LOGTO_NON_MEMBER_SESSION",
        "FULLSTACK_LOGTO_EXPIRED_MEMBER_SESSION",
        "FULLSTACK_LOGTO_STALE_MEMBER_SESSION",
      ] as const) {
        await addSessionCookie(context, sessionName);
        protectedRequests.length = 0;
        await page.reload();
        await expect(
          page
            .getByRole("main")
            .locator('[data-material-reader-state="access-required"]'),
        ).toBeVisible();
        await expect(image).toHaveCount(0);
        await expect(
          page.getByText("Текущее сохранённое содержимое из PostgreSQL."),
        ).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: /media-proof.txt/u }),
        ).toHaveCount(0);
        await expect(page.locator("iframe")).toHaveCount(0);
        expect(protectedRequests).toEqual([]);
        const deniedFile = await page.request.get(href, { maxRedirects: 0 });
        expect(deniedFile.status()).toBe(404);
        expect(deniedFile.headers()["cache-control"]).toContain("no-store");
        const deniedImage = await page.request.get(protectedImageSource, {
          maxRedirects: 0,
        });
        expect(deniedImage.status()).toBe(404);
        const deniedPlayback = await page.request.post(
          "/api/material-video-playback-sessions",
          {
            headers: { origin: new URL(page.url()).origin },
            multipart: { materialId, videoId },
          },
        );
        expect(deniedPlayback.status()).toBe(403);
        expect(await deniedPlayback.json()).not.toHaveProperty("drmAuthToken");
      }
    } else {
      await expect(image).toBeVisible();
      await expect(
        page.locator("[data-video-player-mount] iframe"),
      ).toBeVisible();
    }
    await addFullStackSession(context);
    await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
    const row = page.getByRole("listitem").filter({ hasText: title });
    await row.getByRole("button", { name: "Снять с публикации" }).click();
    await expect(
      row.getByText("Снят с публикации", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });
}

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

  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "Подключите Telegram" }),
    async (dialog) => {
      await dialog
        .getByRole("button", { name: "Закрыть подключение Telegram" })
        .click();
    },
  );
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  const visibleEditor = page.locator(
    "main[data-material-authoring='true']:visible",
  );
  await expect(visibleEditor).toBeVisible({ timeout: 15_000 });
  const editorUrl = page.url();

  await visibleEditor.getByLabel("Видео для загрузки").setInputFiles({
    buffer: Buffer.from("Full-stack test Video\n"),
    mimeType: "video/mp4",
    name: `test-video-${suffix}.mp4`,
  });
  await expect(page.getByText("Kinescope обрабатывает видео")).toBeVisible();
  await expect(page.getByText("Видео готово")).toBeVisible({ timeout: 15_000 });
  await waitMaterialSaved(page);
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(
    page.locator("header").getByText("Опубликован", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });

  await installPlaybackProviderDouble(page);
  const { promise: playbackGate, resolve: releasePlayback } =
    Promise.withResolvers<undefined>();
  const { promise: playbackRequested, resolve: requestedPlayback } =
    Promise.withResolvers<undefined>();
  await page.route("**/api/material-video-playback-sessions", async (route) => {
    requestedPlayback(undefined);
    await playbackGate;
    await route.continue();
  });
  const readerResponse = await page.goto(`/materials/${slug}`);
  expect(readerResponse?.headers()["content-security-policy"]).toContain(
    "frame-src https://kinescope.io",
  );
  expect(readerResponse?.headers()["content-security-policy"]).toContain(
    "script-src 'self' 'unsafe-inline' https://player.kinescope.io",
  );
  await expect(page.getByRole("region", { name: "Видео" })).toBeVisible();
  await playbackRequested;
  await expect(
    page.getByRole("button", { name: "Загрузить видео" }),
  ).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(providerRequests).toEqual([]);
  releasePlayback(undefined);
  const player = page.locator("[data-video-player-mount] iframe");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("data-autoplay", "false");
  await expect(player).toHaveAttribute("data-preload", "metadata");
  const materialId = await page
    .getByRole("main")
    .locator("[data-material-id]")
    .getAttribute("data-material-id");
  const videoId = await page
    .getByRole("main")
    .locator("[data-video-id]")
    .getAttribute("data-video-id");
  if (typeof materialId !== "string" || typeof videoId !== "string") {
    throw new Error("Video identity evidence is missing");
  }
  const session = await page.request.post(
    "/api/material-video-playback-sessions",
    {
      headers: { origin: new URL(page.url()).origin },
      multipart: { materialId, videoId },
    },
  );
  expect(session.status()).toBe(200);
  await expect(session.json()).resolves.toMatchObject({
    drmAuthToken: null,
    progressScope: "account",
    videoId,
  });
  const anonymousSession = await request.post(
    "/api/material-video-playback-sessions",
    {
      headers: { origin: new URL(page.url()).origin },
      multipart: { materialId, videoId },
    },
  );
  expect(anonymousSession.status()).toBe(200);
  await expect(anonymousSession.json()).resolves.toMatchObject({
    drmAuthToken: null,
    progressScope: "anonymous",
    resumeSeconds: null,
    videoId,
  });

  const progress = await page.request.put("/api/material-video-progress", {
    headers: { origin: new URL(page.url()).origin },
    multipart: {
      durationSeconds: "120",
      materialId,
      positionSeconds: "37",
      videoId,
    },
  });
  expect(progress.status()).toBe(200);
  await expect(progress.json()).resolves.toEqual({ kind: "saved" });
  const resumedSession = await page.request.post(
    "/api/material-video-playback-sessions",
    {
      headers: { origin: new URL(page.url()).origin },
      multipart: { materialId, videoId },
    },
  );
  expect(resumedSession.status()).toBe(200);
  await expect(resumedSession.json()).resolves.toMatchObject({
    progressScope: "account",
    resumeSeconds: 37,
    videoId,
  });
  await page.reload();
  await expect(
    page.locator("[data-video-player-mount] iframe"),
  ).toHaveAttribute("data-seek-seconds", "37");
  // Explicit chapter links win over saved resume, including zero and same-page hash changes.
  await page.goto(`/materials/${slug}#t=3`);
  await expect(page.locator("[data-video-player-mount] iframe")).toHaveAttribute("data-seek-seconds", "3");
  await page.evaluate(() => { window.location.hash = "t=0"; });
  await expect(page.locator("[data-video-player-mount] iframe")).toHaveAttribute("data-seek-seconds", "0");
  await page.evaluate(() => { window.location.hash = "t=261"; });
  await expect(page.locator("[data-video-player-mount] iframe")).toHaveAttribute("data-seek-seconds", "261");
  await page.evaluate(() => { window.location.hash = "t=600"; });
  await expect(page.locator("[data-video-player-mount] iframe")).toHaveAttribute("data-seek-seconds", "261");
  await captureVideoEvidence(page, testInfo, "reader-automatic-player");
  // This fixture is a Guide containing Video: the saved completion belongs to the Material.
  await expect(
    page.locator("[data-reading-action-state]:visible"),
  ).toHaveAttribute("data-reading-action-state", "ready");
  await page
    .locator("[data-reading-action-state]:visible")
    .getByRole("button", { name: "Изучено", exact: true })
    .click();
  await expect(
    page
      .locator("[data-reading-action-state]:visible")
      .getByRole("button", { name: "Изучено", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    sessionStorage.setItem("test-player-unavailable", "1");
  });
  await page.reload();
  await expect(page.getByText("Не удалось загрузить видео")).toBeVisible();
  await expect(
    page
      .locator("[data-reading-action-state]:visible")
      .getByRole("button", { name: "Изучено", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    sessionStorage.removeItem("test-player-unavailable");
  });

  await page.unroute("**/api/material-video-playback-sessions");
  await page.route("**/api/material-video-playback-sessions", (route) =>
    route.fulfill({ status: 403, json: { code: "playback_unavailable" } }),
  );
  providerRequests.length = 0;
  await page.reload();
  await expect(page.getByText("Не удалось загрузить видео")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(providerRequests).toEqual([]);
  await page.unroute("**/api/material-video-playback-sessions");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator("[data-video-player-mount] iframe")).toBeVisible();

  await page.goto(editorUrl);
  await page
    .getByText("Выбрать существующее видео Kinescope", { exact: true })
    .click();
  await page.getByLabel(/ID видео/u).fill(`test-outage-once-${suffix}`);
  await page.getByRole("button", { name: "Привязать" }).click();
  await expect(page.getByText("Нужна повторная попытка")).toBeVisible();
  await page.getByRole("button", { name: "Привязать" }).click();
  await expect(page.getByText("Видео готово")).toBeVisible();
  await waitMaterialSaved(page);
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.goto(`/materials/${slug}`);
  const replacementVideoId = await page
    .getByRole("main")
    .locator("[data-video-id]")
    .getAttribute("data-video-id");
  if (typeof replacementVideoId !== "string") {
    throw new Error("Replacement Video identity is missing");
  }
  expect(replacementVideoId).not.toBe(videoId);
  const staleSession = await page.request.post(
    "/api/material-video-playback-sessions",
    {
      headers: { origin: new URL(page.url()).origin },
      multipart: { materialId, videoId },
    },
  );
  expect(staleSession.status()).toBe(403);
  const replacementSession = await page.request.post(
    "/api/material-video-playback-sessions",
    {
      headers: { origin: new URL(page.url()).origin },
      multipart: { materialId, videoId: replacementVideoId },
    },
  );
  expect(replacementSession.status()).toBe(200);
  await expect(replacementSession.json()).resolves.toMatchObject({
    videoId: replacementVideoId,
  });

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible(
    { timeout: 15_000 },
  );
});

test("explicitly requests deletion of a Platform-uploaded Video through autosave", async ({
  context,
  page,
}, testInfo) => {
  const suffix = String(Date.now());
  const title = `Safe Video deletion ${suffix}`;
  await addFullStackSession(context);
  await page.goto("/authoring/materials/new");
  await completeProfileOnboardingIfPresent(page);
  await fillPublishableDraft(page, title);
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(
    page.locator("main[data-material-authoring='true']:visible"),
  ).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Видео для загрузки").setInputFiles({
    buffer: Buffer.from("Full-stack deletion test Video\n"),
    mimeType: "video/mp4",
    name: `delete-me-${suffix}.mp4`,
  });
  await expect(page.getByText("Видео готово")).toBeVisible({ timeout: 15_000 });
  await waitMaterialSaved(page);
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Удалить…" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Удалить «delete-me-${suffix}» из Kinescope?`,
  });
  await expect(dialog).toBeVisible();
  await captureVideoDeletionEvidence(page, testInfo, "confirmation");
  await dialog
    .getByRole("button", { name: "Убрать и удалить из Kinescope" })
    .click();

  await expect(
    page.getByText(`Удаление «delete-me-${suffix}» сохраняется…`),
  ).toBeVisible();
  await expect(page.getByText("Основное видео не выбрано")).toBeVisible();
  await captureVideoDeletionEvidence(page, testInfo, "pending-save");

  await waitMaterialSaved(page);
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(`Удаление «delete-me-${suffix}» запрошено.`),
  ).toBeVisible();
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
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page
    .getByText("Выбрать существующее видео Kinescope", { exact: true })
    .click();
  await page.getByLabel(/ID видео/u).fill(`member-provider-${suffix}`);
  await page.getByRole("button", { name: "Привязать" }).click();
  await expect(page.getByText("Видео готово")).toBeVisible();
  await waitMaterialSaved(page);
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(
    page.locator("header").getByText("Опубликован", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });

  await page.goto(`/materials/${slug}`);
  const videoSection = page.getByRole("main").locator("section[data-video-id]");
  const materialId = await page
    .getByRole("main")
    .locator("[data-material-reader-state][data-material-id]")
    .getAttribute("data-material-id");
  const videoId = await videoSection.getAttribute("data-video-id");
  if (materialId === null || videoId === null)
    throw new Error("Member Video identity is missing");
  const anonymousSession = await request.post(
    "/api/material-video-playback-sessions",
    {
      headers: { origin: new URL(page.url()).origin },
      multipart: { materialId, videoId },
    },
  );
  expect(anonymousSession.status()).toBe(403);
  await addFullStackMemberSession(context);
  const memberSession = await page.request.post(
    "/api/material-video-playback-sessions",
    {
      headers: { origin: new URL(page.url()).origin },
      multipart: { materialId, videoId },
    },
  );
  expect(memberSession.status()).toBe(200);
  const memberBody = (await memberSession.json()) as {
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
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible(
    { timeout: 15_000 },
  );
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
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.getByLabel("Выбрать файлы").setInputFiles({
    buffer: Buffer.from("Chooser attachment\n"),
    mimeType: "text/plain",
    name: "chooser.txt",
  });
  await dispatchFileEvent(page, "paste", {
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    mimeType: "image/png",
    name: "diagram.png",
  });
  await dispatchFileEvent(page, "drop", {
    base64: Buffer.from("Dropped attachment\n").toString("base64"),
    mimeType: "text/plain",
    name: "dropped.txt",
  });

  const chooser = page
    .locator("[data-node-view-wrapper]")
    .filter({ has: page.locator('input[value="chooser.txt"]') });
  const diagram = page
    .locator("[data-node-view-wrapper]")
    .filter({ has: page.locator("img") });
  const dropped = page
    .locator("[data-node-view-wrapper]")
    .filter({ has: page.locator('input[value="dropped.txt"]') });
  await expect(chooser).toBeVisible({ timeout: 30_000 });
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  await expect(dropped).toBeVisible({ timeout: 30_000 });
  const uploadAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    uploadAccessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  await captureAssetEvidence(page, testInfo, "editor-ready");

  await diagram.getByLabel("Описание изображения").fill("Схема asset flow");

  await waitMaterialSaved(page);
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(
    page.getByRole("img", { name: "Схема asset flow" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /chooser.txt/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /dropped.txt/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ресурсы" })).toHaveCount(0);

  await page.getByRole("link", { name: "Вернуться в редактор" }).last().click();
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(
    page.locator("header").getByText("Опубликован", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.goto(`/materials/${slug}`);
  await expect(
    page.getByRole("img", { name: "Схема asset flow" }),
  ).toBeVisible();
  const fileLink = page.getByRole("link", { name: /chooser.txt/u });
  await expect(fileLink).toBeVisible();
  const readerAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    readerAccessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  await captureAssetEvidence(page, testInfo, "reader-inline-assets");
  const fileResponse = await request.get(
    (await fileLink.getAttribute("href")) ?? "",
  );
  expect(fileResponse.status()).toBe(200);
  expect(fileResponse.headers()["cache-control"]).toContain("immutable");
  expect(fileResponse.headers()["content-disposition"]).toContain("attachment");
  expect(fileResponse.headers()["x-content-type-options"]).toBe("nosniff");

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const publishedRow = page.getByRole("listitem").filter({ hasText: title });
  await publishedRow
    .getByRole("button", { name: "Снять с публикации" })
    .click();
  await expect(
    publishedRow.getByText("Снят с публикации", { exact: true }),
  ).toBeVisible({
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
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.getByLabel("Выбрать файлы").setInputFiles({
    buffer: Buffer.from("Protected member attachment\n"),
    mimeType: "text/plain",
    name: "member-guide.txt",
  });
  const upload = page
    .locator("[data-node-view-wrapper]")
    .filter({ has: page.locator('input[value="member-guide.txt"]') });
  await expect(upload).toBeVisible({ timeout: 30_000 });
  await waitMaterialSaved(page);
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(
    page.locator("header").getByText("Опубликован", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });

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
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible(
    { timeout: 15_000 },
  );
});

test("trusted author creates a PostgreSQL draft and opens its current Preview", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await completeProfileOnboardingIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "Новый материал" }),
  ).toBeVisible();
  await expect(page.getByLabel("Адрес")).toHaveCount(0);

  await page.getByRole("button", { name: "Вернуться к материалам" }).focus();
  await expect(
    page.getByRole("button", { name: "Вернуться к материалам" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Название")).toBeFocused();

  await page.getByLabel("Название").fill("Current Preview без fake data");
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page.getByLabel("Краткое описание")).toHaveValue("");
  await expect(page.getByText("Черновик создан")).toHaveCount(0);

  await page
    .getByLabel("Краткое описание")
    .fill(
      "Черновик проходит Next mutation boundary и сохраняется через Nest MaterialAuthoring.",
    );
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

  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(page.getByLabel("Адрес")).toHaveCount(0);
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Версия", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Предпросмотр" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/authoring/materials/.+/preview(?:\\?.*)?$`, "u"),
  );
  await expect(
    page.getByRole("heading", { name: "Предпросмотр материала" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Current Preview без fake data",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByText("Текущее сохранённое содержимое из PostgreSQL."),
  ).toBeVisible();
  await expect(page.getByText("Гайд")).toBeVisible();
  await expect(page.getByText("Платформа")).toBeVisible();
  await expect(page.getByText("Full stack")).toBeVisible();
  await expect(
    page.getByText("Сохранённый черновик. Материал ещё не опубликован."),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "Материалы", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Редактор" })
      .getByRole("link", { name: "Новый материал" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Как устроен Inside Platform" }),
  ).toBeVisible();
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(page.getByText("Версия", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Topic", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Format", { exact: true })).toHaveCount(0);
  const targetItem = page.getByRole("listitem").filter({
    has: page.getByRole("link", {
      name: "Как устроен Inside Platform",
      exact: true,
    }),
  });
  await expect(
    targetItem.getByText("Платформа", { exact: true }),
  ).toBeVisible();
  await expect(targetItem.getByText("Гайд", { exact: true })).toBeVisible();
  await expect(page.getByText(/Все текущие Materials/u)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Состояние публикации" }),
  ).toContainText("Опубликованные");
  const searchbox = page.getByRole("searchbox", {
    name: "Поиск по названию, описанию или адресу",
  });
  await searchbox.focus();
  await expect(searchbox).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", { name: "Состояние публикации" }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: "Показать" })).toHaveCount(0);
  await searchbox.fill("Developer Pipeline");
  await expect(
    page.getByRole("link", { name: /Developer Pipeline/u }).first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/search=Developer\+Pipeline&state=published/u);
  await searchbox.fill("Как устроен");
  await expect(
    page.getByRole("link", { name: "Как устроен Inside Platform" }),
  ).toBeVisible();

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

  await targetItem.getByRole("link", { name: "Предпросмотр" }).click();
  await expect(
    page.getByRole("heading", { name: "Предпросмотр материала" }),
  ).toBeVisible();
  await expect(page.getByText("Reader verification checklist")).toBeVisible();
  await page.getByRole("link", { name: "К материалам" }).click();
  await expect(page).toHaveURL(listUrl);

  await targetItem.getByRole("link", { name: "Редактировать" }).click();
  await expect(
    page.getByRole("heading", { name: "Как устроен Inside Platform" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Вернуться к материалам" }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(
    page.getByRole("link", { name: "Как устроен Inside Platform" }),
  ).toBeVisible();

  await page
    .getByRole("main")
    .getByRole("link", { name: "Новый материал" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Новый материал" }),
  ).toBeVisible();
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
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await expect(
    page.getByRole("button", { name: "Предпросмотр" }),
  ).toBeEnabled();
  const editorUrl = page.url();
  const stalePage = await context.newPage();
  await stalePage.goto(editorUrl);
  await expect(
    stalePage.getByRole("heading", { name: initialTitle }),
  ).toBeVisible();
  await expect(stalePage.getByText(/^v\d+$/u)).toHaveCount(0);

  await page.getByLabel("Название").fill(winnerTitle);
  await page.getByLabel("Название").press("Enter");
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Сохранить" })).toHaveCount(0);

  const localSummary = "Локальный ввод stale editor должен остаться на месте.";
  await stalePage.getByLabel("Краткое описание").fill(localSummary);
  await expect(stalePage.getByRole("main").getByRole("alert")).toContainText(
    "Материал изменился в другой сессии",
  );
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(
    localSummary,
  );

  const currentPreviewPromise = context.waitForEvent("page");
  await stalePage.getByRole("button", { name: "Сравнить" }).click();
  const currentPreview = await currentPreviewPromise;
  await currentPreview.waitForLoadState();
  await expect(
    currentPreview.getByRole("heading", { name: winnerTitle, level: 1 }),
  ).toBeVisible();
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(
    localSummary,
  );

  const currentEditorPromise = context.waitForEvent("page");
  await stalePage.getByRole("button", { name: "Открыть текущую" }).click();
  const currentEditor = await currentEditorPromise;
  await currentEditor.waitForLoadState();
  await expect(currentEditor.getByLabel("Название")).toHaveValue(winnerTitle);
  await expect(stalePage.getByLabel("Краткое описание")).toHaveValue(
    localSummary,
  );

  await expect(page.getByLabel("Адрес")).toHaveCount(0);
  await page.getByRole("button", { name: "Опубликовать" }).click();
  await expect(
    page.locator("header").getByText("Опубликован", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await expect(
    page.getByText("Опубликован", { exact: true }).first(),
  ).toBeVisible();

  const publicPage = await context.newPage();
  await publicPage.goto(`/materials/${slug}`);
  await expect(
    publicPage.getByRole("heading", { name: winnerTitle, level: 1 }),
  ).toBeVisible();
  await expect(
    publicPage
      .getByRole("main")
      .getByText("Текущее сохранённое содержимое из PostgreSQL."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(
    page.locator("header").getByText("Снят с публикации", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator("header [role=status]").filter({ hasText: "Сохранено" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^v\d+$/u)).toHaveCount(0);
  await publicPage.reload();
  await expect(
    publicPage.getByRole("heading", { name: "Материал не найден" }),
  ).toBeVisible();
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
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.goto(`/authoring/materials?search=${encodeURIComponent(title)}`);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("Черновик", { exact: true })).toBeVisible();
  const deleteButton = row.getByRole("button", { name: "Удалить черновик" });
  await expect(deleteButton).toBeVisible();
  await captureLifecycleEvidence(page, testInfo, "live-lifecycle");
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", {
    name: `Удалить «${title}»?`,
  });
  await expect(deleteDialog).toBeVisible();
  await captureLifecycleEvidence(page, testInfo, "live-delete-confirmation");
  await deleteDialog.getByRole("button", { name: "Оставить черновик" }).click();
  await expect(deleteDialog).toBeHidden();

  await row.getByRole("button", { name: "Опубликовать" }).click();
  await expect(row.getByText("Опубликован", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    row.getByRole("button", { name: "Снять с публикации" }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Удалить черновик" }),
  ).toHaveCount(0);

  await row.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(row.getByText("Снят с публикации", { exact: true })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await expect(row.getByRole("button", { name: "Опубликовать" })).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Удалить черновик" }),
  ).toHaveCount(0);
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
  await expect(page).toHaveURL(currentMaterialEditorUrl);
  await waitMaterialSaved(page);
  await expect(page).toHaveURL(currentMaterialEditorUrl);

  await page.locator("summary").filter({ hasText: "Удалить черновик" }).click();
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
  await expect(
    page.getByRole("heading", { name: "Предпросмотр не найден" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Повторить" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Вернуться в редактор" }),
  ).toBeVisible();
});

test("trusted author reorders a PostgreSQL series with keyboard controls", async ({
  context,
  page,
}) => {
  await addFullStackSession(context);

  const response = await page.goto("/authoring/playlists");
  expect(response?.status()).toBe(200);
  const seriesRow = page
    .getByRole("article")
    .filter({ hasText: "Создание Platform Inside" });
  const openComposition = async () => {
    await seriesRow
      .getByRole("button", { name: /Создание Platform Inside/u })
      .click();
    await seriesRow
      .getByRole("button", { name: "Материалы серии", exact: true })
      .click();
  };
  await openComposition();
  await expect(page).toHaveURL(/\/authoring\/playlists$/u);

  await page.getByRole("button", { name: "Добавить материал" }).click();
  const picker = page.getByRole("dialog", { name: "Добавить материал" });
  await expect(picker).toBeVisible();
  await expect(
    picker.getByRole("button", { name: /^Добавить «/u }).first(),
  ).toBeVisible();
  await picker
    .getByRole("searchbox", { name: "Поиск материала для добавления" })
    .fill("Самостоятельная заметка");
  const addStandalone = picker
    .getByRole("button", {
      name: /Добавить «Demo #295 · Самостоятельная заметка/u,
    })
    .first();
  await expect(addStandalone).toBeVisible();
  await addStandalone.click();
  await picker.getByRole("button", { name: "Закрыть выбор материала" }).click();
  await expect(picker).toBeHidden();

  const items = page
    .getByRole("list", { name: "Материалы серии" })
    .getByRole("listitem");
  const countAfterAdd = await items.count();
  expect(countAfterAdd).toBeGreaterThan(2);
  const firstTitle = await items.first().locator("p").first().innerText();
  const secondTitle = await items.nth(1).locator("p").first().innerText();
  await items
    .first()
    .getByRole("textbox", { name: "Последовательность шагов" })
    .fill("Full-stack instruction");
  const moveDown = items.first().getByRole("button", {
    name: `Опустить «${firstTitle}»`,
  });
  await moveDown.focus();
  await expect(moveDown).toBeFocused();
  await page.keyboard.press("Enter");

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

  await expect(
    page.getByText("Порядок сохранён.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Порядок сохранён.")).toBeVisible();

  const standaloneItem = items.filter({
    hasText: "Demo #295 · Самостоятельная заметка",
  });
  await standaloneItem
    .getByRole("button", {
      name: /Убрать «Demo #295 · Самостоятельная заметка/u,
    })
    .click();
  await expect(items).toHaveCount(countAfterAdd - 1);
  await expect(
    page.getByText("Порядок сохранён.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Порядок сохранён.")).toBeVisible();
  await page.reload();
  await openComposition();
  await expect(items.first().locator("p").first()).toHaveText(secondTitle);
  const groupedItem = items.filter({
    has: page.locator("p", { hasText: firstTitle }),
  });
  await expect(
    groupedItem.getByRole("textbox", { name: "Последовательность шагов" }),
  ).toHaveValue("Full-stack instruction");
  await groupedItem
    .getByRole("textbox", { name: "Последовательность шагов" })
    .clear();
  await expect(
    page.getByText("Порядок сохранён.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Порядок сохранён.")).toBeVisible();
});

test("guest cannot reach the production Material editor", async ({ page }) => {
  const response = await page.goto("/authoring/materials/new");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Нет доступа к редактору" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Создать черновик" }),
  ).toHaveCount(0);
});

test("guest cannot reach the production playlist manager", async ({ page }) => {
  const response = await page.goto("/authoring/playlists");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Нет доступа к редактору" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toHaveCount(0);
});

async function addFullStackSession(context: BrowserContext) {
  await addSessionCookie(context, "FULLSTACK_LOGTO_SESSION");
}

async function addFullStackMemberSession(context: BrowserContext) {
  await addSessionCookie(context, "FULLSTACK_LOGTO_MEMBER_SESSION");
}

async function addSessionCookie(
  context: BrowserContext,
  environmentName:
    | "FULLSTACK_LOGTO_MEMBER_SESSION"
    | "FULLSTACK_LOGTO_SESSION"
    | "FULLSTACK_LOGTO_NON_MEMBER_SESSION"
    | "FULLSTACK_LOGTO_EXPIRED_MEMBER_SESSION"
    | "FULLSTACK_LOGTO_STALE_MEMBER_SESSION",
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
    .fill(
      "Full-state Save проходит через production Editor и Nest MaterialAuthoring.",
    );
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
  file: {
    readonly base64: string;
    readonly mimeType: string;
    readonly name: string;
  },
): Promise<void> {
  await page.locator("#material-body").evaluate(
    (element, input) => {
      const bytes = Uint8Array.from(atob(input.file.base64), (character) =>
        character.charCodeAt(0),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], input.file.name, { type: input.file.mimeType }),
      );
      const event =
        input.eventType === "paste"
          ? new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: transfer,
            })
          : new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
            });
      element.dispatchEvent(event);
    },
    { eventType, file },
  );
}

async function waitMaterialSaved(page: Page) {
  await expect(page.locator("header [role=status]")).toContainText(
    "Сохранено",
    { timeout: 15_000 },
  );
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
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-180",
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

async function captureVideoEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-183",
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

async function captureVideoDeletionEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (process.env.CAPTURE_EVIDENCE !== "1") return;
  const evidenceDirectory = resolve(
    process.cwd(),
    "../../docs/evidence/issue-227",
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

/** Replace only the external player SDK; access/session/progress still use the real BFF and backend. */
async function installPlaybackProviderDouble(page: Page): Promise<void> {
  await page.route("https://kinescope.io/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html lang='ru'><title>Test video</title><body>Test video</body></html>",
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "Kinescope", {
      value: {
        IframePlayer: {
          version: "1.0.0",
          create: (
            mount: HTMLElement,
            options: {
              url: string;
              behavior: { autoPlay: boolean; preload: string };
            },
          ) => {
            if (sessionStorage.getItem("test-player-unavailable") === "1") {
              return Promise.reject(new Error("Test provider outage"));
            }
            const iframe = document.createElement("iframe");
            iframe.src = options.url;
            iframe.style.cssText = "width:100%;height:100%;border:0";
            iframe.dataset.autoplay = String(options.behavior.autoPlay);
            iframe.dataset.preload = options.behavior.preload;
            mount.append(iframe);
            return Promise.resolve({
              Events: { TimeUpdate: "time", Pause: "pause", Ended: "ended" },
              destroy: () => {
                iframe.remove();
                return Promise.resolve();
              },
              // Match the authoritative duration returned by the local test Video provider.
              getDuration: () => Promise.resolve(600),
              on: () => undefined,
              seekTo: (seconds: number) => {
                iframe.dataset.seekSeconds = String(seconds);
                return Promise.resolve();
              },
            });
          },
        },
      },
    });
  });
}
