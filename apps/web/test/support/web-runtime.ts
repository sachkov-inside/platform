import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

export function configureWebRuntime(): void {
  for (const [name, value] of Object.entries({
    WEB_BASE_URL: "https://inside.example.test",
    BACKEND_BASE_URL: "https://platform-api.example.test",
    LOGTO_ENDPOINT: "https://identity.example.test",
    LOGTO_AUDIENCE: "https://platform-api.example.test",
    LOGTO_APP_ID: "web-module-integration",
    LOGTO_APP_SECRET: "module-confidential-app-secret",
    LOGTO_COOKIE_SECRET: "web-module-integration-cookie-secret",
  }))
    vi.stubEnv(name, value);
}

/** Real immutable image identity, isolated in this Vitest fork's working directory. */
export function useProductionRuntimeImage(): () => void {
  const previousDirectory = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "platform-web-module-image-"));
  const identity = { release: "v1", sourceSha: "1".repeat(40) };
  writeFileSync(
    join(directory, "release-identity.json"),
    JSON.stringify(identity),
  );
  vi.stubEnv("PLATFORM_RELEASE_VERSION", identity.release);
  vi.stubEnv("PLATFORM_SOURCE_SHA", identity.sourceSha);
  process.chdir(directory);
  return () => {
    process.chdir(previousDirectory);
    rmSync(directory, { force: true, recursive: true });
  };
}
