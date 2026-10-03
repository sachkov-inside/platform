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
 *
 * Запас измерен на 204 прогонах CI за 24.09–03.10.2026 (#640): в 408 заданиях Integration и
 * Integration serial нет ни одного срыва срока. Отчёт Vitest в CI печатает каждую проверку дольше
 * 300 мс; её длительность включает `beforeEach` и `afterEach`. Подготовка, ради которой заведена
 * #640, — новые базы с миграциями, засев стенда, построение сценариев — стоит здесь же.
 */
/**
 * Самая долгая проверка без своего бюджета шла 3,6 с: миграция старых ссылок в
 * `material-formats.test.ts`, где миграция и есть предмет. Запас больше восьми раз.
 */
const stuckTestBudgetMs = 30_000;
/**
 * Отчёт в CI не показывает `beforeAll` отдельно. Верхняя граница хуков файла — время файла без
 * напечатанных проверок. У файлов без своего бюджета хука она не больше 9,0 с: это засев стенда
 * в `content-covers.test.ts`. Запас больше шести раз.
 */
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
