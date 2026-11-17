import { createServer } from "node:http";
import {
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("material-video");
let browsers: ReadonlyMap<string, Browser> = new Map();
let url = "";
beforeAll(async () => {
  const started = await fixture.start();
  browsers = started.browsers;
  url = started.url;
}, 30_000);
afterAll(() => fixture.close(), 30_000);

async function selectFile(page: Page) {
  await page
    .getByLabel("Видео для загрузки")
    .evaluate((input: HTMLInputElement) => {
      const files = new DataTransfer();
      files.items.add(
        new File([new Uint8Array([1, 2, 3, 4])], "lesson.mp4", {
          type: "video/mp4",
          lastModified: 1_700_000_000_000,
        }),
      );
      input.files = files.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
}
const uploading = {
  access: "closed",
  materialId: "02000000-0000-4000-8000-000000000010",
  origin: "platform_upload",
  protected: true,
  state: "uploading",
  title: "lesson",
  videoId: "03000000-0000-4000-8000-000000000001",
};
async function initializeUpload(
  page: Page,
  endpoint = "https://uploads.video.example/files/first",
) {
  await page.route("**/api/authoring/material-video-uploads", (route) =>
    route.fulfill({
      json: {
        kind: "ready",
        value: {
          providerVideoId: "external-provider-video",
          uploadEndpoint: endpoint,
          video: uploading,
        },
      },
    }),
  );
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`${engine}: video harness renders the real authoring component`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(url);
      await browserExpect(
        page.getByRole("button", { name: "Загрузить", exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

declare global {
  interface Window {
    __videoUploadAborts: number;
    __videoProbeDone: boolean | undefined;
  }
}
async function observeNativeAbort(page: Page) {
  await page.addInitScript(() => {
    window.__videoUploadAborts = 0;
    // The observer forwards the real native method with its original receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const abort = XMLHttpRequest.prototype.abort;
    XMLHttpRequest.prototype.abort = function (this: XMLHttpRequest) {
      window.__videoUploadAborts += 1;
      abort.call(this);
    };
  });
}
for (const engine of ["chromium", "webkit"] as const) {
  for (const end of ["Toggle visibility", "Toggle mount"] as const) {
    test(`${engine}: ${end} aborts a real TUS request without deleting its resumable resource`, async () => {
      const browser = browsers.get(engine);
      if (browser === undefined) throw new Error(`Missing ${engine}`);
      const context = await browser.newContext();
      const release = Promise.withResolvers<undefined>();
      const received = Promise.withResolvers<undefined>();
      const settled = Promise.withResolvers<undefined>();
      try {
        const page = await context.newPage();
        await observeNativeAbort(page);
        await initializeUpload(page);
        const methods: string[] = [];
        await page.route("https://uploads.video.example/**", async (route) => {
          const method = route.request().method();
          methods.push(method);
          if (method !== "HEAD")
            throw new Error(`Unexpected TUS request: ${method}`);
          received.resolve(undefined);
          try {
            await release.promise;
            if (route.request().failure() === null)
              await route.fulfill({
                status: 200,
                headers: {
                  "Tus-Resumable": "1.0.0",
                  "Upload-Offset": "0",
                  "Upload-Length": "4",
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Expose-Headers":
                    "Upload-Offset,Upload-Length,Tus-Resumable",
                },
              });
          } finally {
            settled.resolve(undefined);
          }
        });
        await page.goto(url);
        await selectFile(page);
        await received.promise;
        await page.getByRole("button", { name: "Refresh props" }).click();
        await browserExpect(page.getByLabel("Revision")).toHaveText("1");
        await browserExpect
          .poll(() => page.evaluate(() => window.__videoUploadAborts))
          .toBe(0);
        await page.getByRole("button", { name: end, exact: true }).click();
        await browserExpect
          .poll(() => page.evaluate(() => window.__videoUploadAborts))
          .toBe(1);
        release.resolve(undefined);
        await settled.promise;
        await page.getByRole("button", { name: end, exact: true }).click();
        await browserExpect(page.getByLabel("Changes")).toHaveText("[]");
        browserExpect(methods).toEqual(["HEAD"]);
      } finally {
        release.resolve(undefined);
        await context.close();
      }
    });
  }
  test(`${engine}: late TUS module delivery cannot leave a transfer running after Activity hides`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    const held = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    try {
      const page = await context.newPage();
      await initializeUpload(page);
      const methods: string[] = [];
      await page.route("https://uploads.video.example/**", (route) => {
        const probe =
          new URL(route.request().url()).pathname === "/files/probe";
        if (!probe) methods.push(route.request().method());
        return route.fulfill({
          status: 200,
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": probe ? "4" : "0",
            "Upload-Length": "4",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers":
              "Upload-Offset,Upload-Length,Tus-Resumable",
          },
        });
      });
      // Synthetic delivery fault: the installed vendor module's actual response is held unchanged.
      await page.route(
        (resource) => resource.pathname.includes("/tus-js-client"),
        async (route) => {
          const response = await route.fetch();
          held.resolve(undefined);
          await release.promise;
          await route.fulfill({ response });
        },
      );
      await page.goto(url);
      await selectFile(page);
      await held.promise;
      await page
        .getByRole("button", { name: "Toggle visibility", exact: true })
        .click();
      release.resolve(undefined);
      // A second real transfer through the existing public adapter is a positive settlement barrier.
      // Its completed HEAD proves the delayed vendor module and adapter have actually run.
      // The probe owns and aborts its own handle; no product adapter or SDK method is substituted.
      await page.addScriptTag({
        content: `
        import("/src/features/material-video/api/video-upload-transfer.browser.ts").then(async ({ startResumableVideoUpload }) => {
          const completed = Promise.withResolvers();
          const probe = await startResumableVideoUpload({
            file: new File([new Uint8Array([1,2,3,4])], "probe.mp4", { type: "video/mp4" }),
            uploadUrl: "https://uploads.video.example/files/probe",
            signal: new AbortController().signal,
            onError: () => completed.reject(new Error("Probe upload failed")),
            onProgress: () => {}, onSuccess: () => completed.resolve(),
          });
          await completed.promise;
          await probe?.abort(false);
          window.__videoProbeDone = true;
        });
      `,
      });
      await browserExpect
        .poll(() => page.evaluate(() => window.__videoProbeDone))
        .toBe(true);
      await browserExpect(page.getByLabel("Changes")).toHaveText("[]");
      browserExpect(methods.filter((method) => method !== "HEAD")).toEqual([]);
    } finally {
      release.resolve(undefined);
      await context.close();
    }
  });
  test(`${engine}: the same file retains its exact submission identity through an uncertain response and remount`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const bodies: unknown[] = [];
      await page.route("**/api/authoring/material-video-uploads", (route) => {
        bodies.push(route.request().postDataJSON());
        return route.fulfill({ json: { kind: "unavailable" } });
      });
      await page.goto(url);
      await selectFile(page);
      await browserExpect(
        page.getByText("Нужна повторная попытка", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Toggle mount", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Toggle mount", exact: true })
        .click();
      await selectFile(page);
      await browserExpect.poll(() => bodies.length).toBe(2);
      browserExpect(bodies[1]).toEqual(bodies[0]);
      browserExpect(bodies[0]).toMatchObject({
        access: "closed",
        byteSize: 4,
        filename: "lesson.mp4",
        materialId: "02000000-0000-4000-8000-000000000010",
        title: "lesson",
        submissionId: browserExpect.stringMatching(/^[0-9a-f-]{36}$/u),
      });
    } finally {
      await context.close();
    }
  });
  test(`${engine}: an adopted processing upload never blocks navigation`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${url}?adopted`);
      await browserExpect(
        page.getByText("Adopted upload", { exact: true }),
      ).toBeVisible();
      browserExpect(
        await page.evaluate(() => {
          const leaving = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(leaving);
          return leaving.defaultPrevented;
        }),
      ).toBe(false);
    } finally {
      await context.close();
    }
  });
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`${engine}: real TUS resumes the existing byte offset and reconciles the completed video`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    const methods: string[] = [];
    const payloads: number[][] = [];
    const provider = createServer((request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "HEAD,PATCH,OPTIONS");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Tus-Resumable,Upload-Offset,Content-Type",
      );
      response.setHeader(
        "Access-Control-Expose-Headers",
        "Upload-Offset,Upload-Length,Tus-Resumable",
      );
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const method = request.method ?? "unknown";
      methods.push(method);
      const chunks: Buffer[] = [];
      request.on("data", (chunk: unknown) => {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      });
      request.on("end", () => {
        if (method === "PATCH") payloads.push([...Buffer.concat(chunks)]);
        response.setHeader("Tus-Resumable", "1.0.0");
        response.setHeader("Upload-Offset", method === "HEAD" ? "2" : "4");
        response.setHeader("Upload-Length", "4");
        response.writeHead(method === "HEAD" ? 200 : 204);
        response.end();
      });
    });
    try {
      const page = await context.newPage();
      await new Promise<void>((resolve, reject) => {
        provider.once("error", reject);
        provider.listen(0, "127.0.0.1", resolve);
      });
      const address = provider.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing TUS provider address");
      const ready = { ...uploading, state: "ready", durationSeconds: 600 };
      await initializeUpload(
        page,
        `http://127.0.0.1:${String(address.port)}/files/first`,
      );
      await page.route(
        "**/api/authoring/material-video-reconciliations",
        (route) => route.fulfill({ json: { kind: "ready", value: ready } }),
      );
      await page.goto(url);
      await selectFile(page);
      await browserExpect(
        page.getByText("Видео готово", { exact: true }),
      ).toBeVisible();
      browserExpect(methods).toEqual(["HEAD", "PATCH"]);
      browserExpect(payloads).toEqual([[3, 4]]);
      await browserExpect
        .poll(() =>
          page.getByLabel("Changes").evaluate((output) => {
            const value: unknown = JSON.parse(output.textContent);
            return value;
          }),
        )
        .toEqual([[ready, null, null]]);
      browserExpect(
        await page.evaluate(
          () =>
            Object.keys(localStorage).filter((key) =>
              key.startsWith("inside.video-upload.v1:"),
            ).length,
        ),
      ).toBe(0);
    } finally {
      await context.close();
      if (provider.listening) {
        await new Promise<void>((resolve, reject) => {
          provider.close((error) => {
            if (error !== undefined) reject(error);
            else resolve();
          });
        });
      }
      browserExpect(provider.listening).toBe(false);
    }
  });
}
