import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parsePlatformMode } from "./platform-config.js";

export const repositoryEnvPath = fileURLToPath(
  new URL("../../../../.env", import.meta.url),
);

/**
 * Какой env-файл берёт композиция Nest, когда собирает конфигурацию сама. У тестового режима такого
 * файла нет: личный `.env` описывает обстановку одной машины, и собранная из него проверка
 * подтверждала бы содержимое чужого диска. Скрипт, которому личное окружение нужно, просит его сам
 * через `loadRepositoryEnvironment`. Правило описано в `docs/runbooks/runtime-configuration.md`.
 */
export function composedEnvFilePath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return parsePlatformMode(environment.NODE_ENV) === "test"
    ? undefined
    : repositoryEnvPath;
}

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
