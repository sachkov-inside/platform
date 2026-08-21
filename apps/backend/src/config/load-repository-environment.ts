import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repositoryEnvPath = resolve(__dirname, "../../../..", ".env");

let loaded = false;

export function loadRepositoryEnvironment(): void {
  if (loaded) {
    return;
  }

  if (existsSync(repositoryEnvPath)) {
    process.loadEnvFile(repositoryEnvPath);
  }

  loaded = true;
}
