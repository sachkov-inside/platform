import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";

import { migrateToLatest } from "../../../src/migrations/index.js";

declare module "vitest" {
  export interface ProvidedContext {
    postgresAdminUrl: string;
    postgresMigratedTemplate: string;
  }
}

/**
 * Полный прогон миграций стоит секунды на каждую базу, а наборы строят их сотнями. Схема
 * мигрируется один раз в шаблон, и каждая мигрированная база копируется из него. Проверки
 * самих миграций по-прежнему начинают с пустой базы: `createTestDatabase`.
 */
const MIGRATED_TEMPLATE = "inside_migrated_template";

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer(
    "postgres:18.4-alpine",
  ).start();
  const adminUrl = container.getConnectionUri();
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${MIGRATED_TEMPLATE}`);
    const templateUrl = new URL(adminUrl);
    templateUrl.pathname = `/${MIGRATED_TEMPLATE}`;
    await migrateToLatest(templateUrl.toString());
    // Копия из шаблона требует, чтобы к нему никто не был подключён; отмечаем его шаблоном и
    // закрываем подключения, чтобы тест не мог случайно писать в общий источник.
    await admin.query(
      `ALTER DATABASE ${MIGRATED_TEMPLATE} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`,
    );
  } finally {
    await admin.end();
  }
  project.provide("postgresAdminUrl", adminUrl);
  project.provide("postgresMigratedTemplate", MIGRATED_TEMPLATE);

  return async () => {
    await container.stop();
  };
}
