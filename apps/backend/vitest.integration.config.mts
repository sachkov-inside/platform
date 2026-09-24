import { defineConfig } from "vitest/config";

/**
 * Файлы, которые делят с остальными не только PostgreSQL: собственный брокер RabbitMQ, аварийные
 * процессы под SIGKILL или общий для машины файл готовности воркера. Параллельно с остальным
 * набором они измеряют загрузку runner, а не поведение, поэтому идут отдельной группой по одному.
 */
const serialFiles = [
  "test/integration/billing-notices-broker.test.ts",
  "test/integration/billing-payments.test.ts",
  "test/integration/material-announcement-broker.test.ts",
  "test/integration/notification-transport.test.ts",
  "test/integration/notifications-acceptance.test.ts",
  "test/integration/notifications-broker.test.ts",
  "test/integration/notifications.test.ts",
  "test/integration/runtime-readiness.test.ts",
];

/**
 * Бюджеты останавливают только застрявший прогон. Тест, которому нужно больше, называет свой
 * срок сам и объясняет его; поднимать эти числа ради нестабильного теста нельзя.
 */
const stuckTestBudgetMs = 30_000;
const stuckHookBudgetMs = 60_000;

export default defineConfig({
  test: {
    globalSetup: ["test/integration/setup/postgres.global.ts"],
    testTimeout: stuckTestBudgetMs,
    hookTimeout: stuckHookBudgetMs,
    projects: [
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          exclude: serialFiles,
          fileParallelism: true,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "integration-serial",
          include: serialFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
