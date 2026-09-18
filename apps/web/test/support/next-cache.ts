/**
 * Модульные проверки вызывают обработчики вне запроса Next.js, где у кеша нет хранилища и
 * `revalidateTag` бросает инвариант. Сами обращения к кешу проверяются там, где их можно
 * подменить по имени: `vi.mock("@/shared/api/catalog-cache.server")`.
 */
export const cacheLife = (): void => undefined;
export const cacheTag = (): void => undefined;
export const revalidateTag = (): void => undefined;
