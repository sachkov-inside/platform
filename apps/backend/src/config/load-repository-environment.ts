import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryEnvPath = fileURLToPath(new URL("../../../../.env", import.meta.url));

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
