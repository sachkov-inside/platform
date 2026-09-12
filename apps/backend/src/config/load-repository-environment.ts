import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const repositoryEnvPath = fileURLToPath(
  new URL("../../../../.env", import.meta.url),
);

/**
 * Личный `.env` описывает обстановку одной машины: порты, которые разработчик занял под свой стенд.
 * Тестовый процесс — не развёрнутое окружение, и собирать из этого файла нечего: проверка иначе
 * подтверждает не поведение кода, а содержимое чужого файла и краснеет у человека со своим стендом.
 * Файл остаётся источником для локального запуска, где он и нужен.
 */
export function repositoryEnvFilePath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return environment.NODE_ENV === "test" ? undefined : repositoryEnvPath;
}

let loaded = false;

export function loadRepositoryEnvironment(): void {
  if (loaded) {
    return;
  }

  const path = repositoryEnvFilePath();
  if (path !== undefined && existsSync(path)) {
    process.loadEnvFile(path);
  }

  loaded = true;
}
