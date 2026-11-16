import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as browserExpect,
  type Browser,
} from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";

import {
  previewVideoId,
  writePreviewPackage,
} from "../../../../tools/authoring/file-preview-test-support.mjs";

const server = fileURLToPath(
  new URL("../../file-preview/server.mjs", import.meta.url),
);
let directory = "";
let preview: ChildProcess | undefined;
let baseURL = "";
let browser: Browser | undefined;

/**
 * The preview runs as Content Studio starts it: `server.mjs --package <export folder> --port 0`,
 * announcing its address on the first line of output.
 */
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "file-preview-browser-"));
  await writePreviewPackage(join(directory, "exports/first"));
  const started = (preview = spawn(
    process.execPath,
    [server, "--package", join(directory, "exports"), "--port", "0"],
    {
      env: {
        ...process.env,
        INSIDE_FILE_PREVIEW_CACHE_DIR: join(directory, "vite-cache"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  ));
  const line = await new Promise<string>((resolveLine, reject) => {
    createInterface({ input: started.stdout }).once("line", (first) => {
      resolveLine(first);
    });
    started.once("exit", (code) => {
      reject(new Error(`The preview exited with ${String(code)}`));
    });
  });
  const address = /^Preview: (http:\/\/127\.0\.0\.1:\d+\/)$/u.exec(line)?.[1];
  if (address === undefined)
    throw new Error(`The preview announced no address: ${line}`);
  baseURL = address;
  browser = await chromium.launch();
}, 120_000);

/** The preview stops on SIGTERM; the hook's own timeout bounds the wait, and SIGKILL follows. */
afterAll(async () => {
  try {
    await browser?.close();
    if (preview?.exitCode === null) {
      const exited = new Promise((resolveExit) => {
        preview?.once("exit", resolveExit);
      });
      preview.kill("SIGTERM");
      await exited;
    }
  } finally {
    if (preview?.exitCode === null) preview.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("a lesson opens from the package in the site's reader with its image, code, exercise and video", async () => {
  if (browser === undefined) throw new Error("No browser");
  const page = await browser.newPage();
  await page.goto(new URL("materials/lesson-one", baseURL).href);
  await browserExpect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Как агент работает с проектом",
    { timeout: 60_000 },
  );
  const image = page.getByRole("img", { name: "Схема сессий" });
  await browserExpect(image).toBeVisible();
  // The image is the package's own file, served by the preview.
  await browserExpect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBeGreaterThan(0);
  await browserExpect(
    page.getByText("export const ready = true;"),
  ).toBeVisible();
  await browserExpect(
    page.getByText("Что останется к следующей сессии?"),
  ).toBeVisible();
  await browserExpect(
    page.locator(`[data-file-preview-video="${previewVideoId}"]`),
  ).toBeVisible();
  await browserExpect(
    page.getByRole("link", { name: "Подготовка проекта" }).first(),
  ).toBeVisible();
  await page.close();
}, 120_000);

test("a Task opens as the learner's Task page", async () => {
  if (browser === undefined) throw new Error("No browser");
  const page = await browser.newPage();
  await page.goto(new URL("products/course/tasks/task-one", baseURL).href);
  await browserExpect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Задание 1. Подготовь основу",
    { timeout: 60_000 },
  );
  await browserExpect(
    page.getByRole("heading", { name: "Что сделать" }),
  ).toBeVisible();
  await page.close();
}, 120_000);

test("a new export reloads the open page with the edited lesson, and a broken one shows its cause", async () => {
  if (browser === undefined) throw new Error("No browser");
  const page = await browser.newPage();
  await page.goto(new URL("materials/lesson-one", baseURL).href);
  const heading = page.getByRole("heading", { level: 1 });
  await browserExpect(heading).toHaveText("Как агент работает с проектом", {
    timeout: 60_000,
  });

  await writePreviewPackage(join(directory, "exports/second"), (manifest) => ({
    ...manifest,
    materials: manifest.materials.map((row) =>
      row.sourceId === "lesson-one"
        ? { ...row, title: "Как агент читает проект" }
        : row,
    ),
  }));
  await browserExpect(heading).toHaveText("Как агент читает проект", {
    timeout: 30_000,
  });

  await writePreviewPackage(join(directory, "exports/third"), (manifest) => ({
    ...manifest,
    materials: manifest.materials.map((row) => {
      if (row.sourceId !== "lesson-one") return row;
      const { readerBlocks: _authored, ...markdownOnly } = row;
      return { ...markdownOnly, markdown: "![Нет](absent.png)\n" };
    }),
  }));
  await browserExpect(
    page.getByRole("heading", { name: "Пакет не открывается" }),
  ).toBeVisible({ timeout: 30_000 });
  await browserExpect(
    page.getByText("works/lesson-one.md: unresolved image: absent.png"),
  ).toBeVisible();
  await page.close();
}, 120_000);
