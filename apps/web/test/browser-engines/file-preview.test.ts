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
let readOnly: ChildProcess | undefined;
let edited: ChildProcess | undefined;
let readOnlyURL = "";
let editedURL = "";
let browser: Browser | undefined;

/** The arguments Content Studio starts the preview with: its export folder and any free port. */
function previewArguments(exports: string) {
  return [server, "--package", exports, "--port", "0"];
}

function previewOptions(cache: string) {
  return {
    env: {
      ...process.env,
      INSIDE_FILE_PREVIEW_CACHE_DIR: join(directory, cache),
    },
    stdio: ["ignore", "pipe", "inherit"] as ["ignore", "pipe", "inherit"],
  };
}

/** The address the preview announces on its first line of output. */
async function announcedAddress(child: ChildProcess): Promise<string> {
  const output = child.stdout;
  if (output === null) throw new Error("The preview has no output");
  const line = await new Promise<string>((resolveLine, reject) => {
    createInterface({ input: output }).once("line", resolveLine);
    child.once("exit", (code) => {
      reject(new Error(`The preview exited with ${String(code)}`));
    });
  });
  const address = /^Preview: (http:\/\/127\.0\.0\.1:\d+\/)$/u.exec(line)?.[1];
  if (address === undefined)
    throw new Error(`The preview announced no address: ${line}`);
  return address;
}

/** Resolves when the child has exited. */
function exitOf(child: ChildProcess): Promise<unknown> {
  return new Promise((resolveExit) => {
    child.once("exit", resolveExit);
  });
}

/**
 * Two previews: the read-only tests share one, and the reload test owns the other with its own export
 * folder, which it edits and breaks.
 */
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "file-preview-browser-"));
  await writePreviewPackage(join(directory, "read-only/first"));
  await writePreviewPackage(join(directory, "edited/first"));
  readOnly = spawn(
    process.execPath,
    previewArguments(join(directory, "read-only")),
    previewOptions("read-only-cache"),
  );
  edited = spawn(
    process.execPath,
    previewArguments(join(directory, "edited")),
    previewOptions("edited-cache"),
  );
  [readOnlyURL, editedURL] = await Promise.all([
    announcedAddress(readOnly),
    announcedAddress(edited),
  ]);
  browser = await chromium.launch();
}, 120_000);

/** A preview stops on SIGTERM; the hook's own timeout bounds the wait, and SIGKILL follows. */
afterAll(async () => {
  try {
    await browser?.close();
    if (readOnly?.exitCode === null) {
      const exited = exitOf(readOnly);
      readOnly.kill("SIGTERM");
      await exited;
    }
    if (edited?.exitCode === null) {
      const exited = exitOf(edited);
      edited.kill("SIGTERM");
      await exited;
    }
  } finally {
    if (readOnly?.exitCode === null) readOnly.kill("SIGKILL");
    if (edited?.exitCode === null) edited.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("a lesson opens from the package in the site's reader with its image, code, exercise and video", async () => {
  if (browser === undefined) throw new Error("No browser");
  const page = await browser.newPage();
  await page.goto(new URL("materials/lesson-one", readOnlyURL).href);
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
  await page.goto(new URL("products/course/tasks/task-one", readOnlyURL).href);
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
  await page.goto(new URL("materials/lesson-one", editedURL).href);
  const heading = page.getByRole("heading", { level: 1 });
  await browserExpect(heading).toHaveText("Как агент работает с проектом", {
    timeout: 60_000,
  });

  await writePreviewPackage(join(directory, "edited/second"), (manifest) => ({
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

  await writePreviewPackage(join(directory, "edited/third"), (manifest) => ({
    ...manifest,
    materials: manifest.materials.map((row) => {
      if (row.sourceId !== "lesson-one") return row;
      const { readerBlocks: _authored, ...markdownOnly } = row;
      return { ...markdownOnly, markdown: "![Нет](absent.png)\n" };
    }),
  }));
  await browserExpect(
    page.getByRole("heading", { name: "Страница не собирается" }),
  ).toBeVisible({ timeout: 30_000 });
  await browserExpect(
    page.getByText("works/lesson-one.md: unresolved image: absent.png"),
  ).toBeVisible();
  await page.close();
}, 120_000);
