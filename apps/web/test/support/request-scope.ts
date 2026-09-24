import { vi } from "vitest";

/**
 * Каждый `GET`-обработчик начинается с `connection()`, чтобы его ответ не предсобрался при сборке
 * (ADR 0027). Вне запроса Next.js у неё нет области, поэтому модульные проверки, которые зовут
 * обработчик напрямую, получают запрос уже «подключённым». Проверка, которой важен сам отказ от
 * предсборки, подменяет `connection` у себя.
 */
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connection: () => Promise.resolve(),
}));
