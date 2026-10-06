import { availableParallelism } from "node:os";

import { defineConfig } from "vitest/config";

import { integrationWorkerBudget } from "./test/integration/setup/worker-budget.js";

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
 * срок сам и объясняет его; поднимать эти числа ради нестабильного теста нельзя. Свой срок ниже
 * общего тесту не нужен: надёжнее тест от него не становится, только раньше обрывается на медленном
 * runner. Такие сроки сняты в #870 и #890; почти все ставили, пока общим был срок Vitest по
 * умолчанию, 5 с. `scripts/integration-test-budgets.test.mjs` не даёт вернуть срок ниже общего.
 *
 * Запас измерен на 203 прогонах CI с отчётом Vitest за 24.09–03.10.2026 (#640): в 405 заданиях
 * Integration и Integration serial нет ни одного `Test timed out`. Отчёт печатает каждую
 * проверку дольше 300 мс. Подготовка, ради которой заведена #640, — новые базы с миграциями, засев
 * стенда, построение сценариев — входит в измеренные длительности. Общий бюджет честнее бюджетов
 * по месту: у всех мест из таблицы #640 запас к нему в CI больше шести раз, а отдельный срок у
 * каждого места не сделал бы ни одно из них надёжнее. Проверки со сроком ниже общего в таблицу
 * #640 не входили; их запас измерен в #870, ниже.
 */
/**
 * Длительность проверки включает её `beforeEach` и `afterEach`. Замер #870 тем же методом, но со
 * всеми повторными попытками и по 03.10.2026 13:30 UTC: 248 прогонов CI, 483 задания, ни одного
 * `Test timed out`. Самая долгая проверка без своего бюджета — прогресс серии в
 * `reading-activity.test.ts`: медиана 6,7 с, максимум 10,9 с, запас больше двух с половиной раз.
 * Сто один материал и есть её предмет, а создаёт их authoring по две транзакции на материал.
 * Создание и публикация в одну серию ждут общую блокировку серии, поэтому параллельное создание
 * почти не ускоряет подготовку: локально 2,2 с против 2,6 с. Сто один одновременный запрос к тому
 * же исчерпывает транзакции Prisma (P2028).
 *
 * У остальных проверок запас больше четырёх раз. Дальше всех идут миграция Video origin в
 * `migrations.test.ts` (7,2 с, единичный выброс при медиане 2,1 с) и SIGKILL после Init в
 * `billing-payments.test.ts` (6,4 с). Локально худший случай из #640 — 6,3 с на машине, где импорт
 * набора шёл в 2–4 раза дольше обычного.
 */
const stuckTestBudgetMs = 30_000;
/**
 * Отчёт в CI не показывает `beforeAll` и `afterAll` отдельно. Их верхняя граница — время файла без
 * напечатанных проверок. У файлов, где ни один хук не называет свой срок, она не больше 11,9 с:
 * это три засева стенда в `local-development-seed.test.ts` (замер #890 по 278 заданиям Integration
 * за 24.09–03.10.2026), запас больше пяти раз. Следом идёт засев в `content-covers.test.ts`, 9,0 с.
 * В двух файлах `afterAll` без своего срока идёт рядом с `beforeAll`, у которого срок свой, и метод
 * их не разделяет. Больше 9,0 с вместе только у `material-assets-object-storage.test.ts` (12,8 с);
 * даже для этой суммы запас больше четырёх раз.
 */
const stuckHookBudgetMs = 60_000;

export default defineConfig({
  test: {
    globalSetup: ["test/integration/setup/postgres.global.ts"],
    maxWorkers: integrationWorkerBudget({
      availableCpuCount: availableParallelism(),
      availableMemoryBytes: process.availableMemory(),
    }),
    testTimeout: stuckTestBudgetMs,
    hookTimeout: stuckHookBudgetMs,
    projects: [
      {
        extends: true,
        test: {
          name: "integration",
          // Root setup provides the same PostgreSQL context to both projects.
          globalSetup: [],
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
          globalSetup: [],
          include: serialFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
