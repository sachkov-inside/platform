import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { INestApplicationContext } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createApiApplication } from "../src/entrypoints/api/create-api-application.js";
import type * as EnvironmentSource from "../src/config/load-repository-environment.js";
import { repositoryEnvPath } from "../src/config/load-repository-environment.js";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../src/config/platform-config.js";

// Композиция спрашивает у этой функции, какой файл читать, и слушается ответа. Два свойства вместе
// держат правило: в тестовом режиме файла нет, и модуль не знает другого пути, кроме отвеченного.
// Порознь любое из них можно потерять молча — и обряд «убери свой `.env` перед проверкой» вернётся.
const source = vi.hoisted(() => ({ path: undefined as string | undefined }));
vi.mock("../src/config/load-repository-environment.js", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvironmentSource>()),
  composedEnvFilePath: () => source.path,
}));

describe("process env file source", () => {
  let directory: string;
  let application: INestApplicationContext | undefined;

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "inside-env-source-"));
    writeFileSync(
      path.join(directory, "declared.env"),
      "OBJECT_STORAGE_REGION=env-file-region\n",
    );
  });

  afterAll(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  afterEach(async () => {
    await application?.close();
    application = undefined;
    source.path = undefined;
    delete process.env.OBJECT_STORAGE_REGION;
    vi.unstubAllEnvs();
  });

  it("names no env file for a test-mode process and the repository file otherwise", async () => {
    const { composedEnvFilePath: resolve } = await vi.importActual<
      typeof EnvironmentSource
    >("../src/config/load-repository-environment.js");
    expect(resolve({ NODE_ENV: "test" })).toBeUndefined();
    expect(resolve({ NODE_ENV: "development" })).toBe(repositoryEnvPath);
    expect(resolve({})).toBe(repositoryEnvPath);
  });

  it("reads the named env file and nothing else", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://inside:inside@127.0.0.1:1/inside");
    source.path = path.join(directory, "declared.env");
    application = await createApiApplication(undefined, { logger: false });
    expect(
      application.get<PlatformConfig>(PLATFORM_CONFIG).objectStorage.region,
    ).toBe("env-file-region");
  });

  it("reads no file when none is named", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://inside:inside@127.0.0.1:1/inside");
    source.path = undefined;
    application = await createApiApplication(undefined, { logger: false });
    expect(
      application.get<PlatformConfig>(PLATFORM_CONFIG).objectStorage.region,
    ).toBe("ru-central1");
  });
});
