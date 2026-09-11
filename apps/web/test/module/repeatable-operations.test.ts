import { expect, it } from "vitest";

import { createRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

it("присоединяет повтор к начатой операции, пока нагрузка не изменилась", () => {
  const operations = createRepeatableOperations();
  const first = operations.operationId("contact-start", { email: "a@b.test" });

  expect(operations.operationId("contact-start", { email: "a@b.test" })).toBe(
    first,
  );
  expect(
    operations.operationId("contact-start", { email: "other@b.test" }),
  ).not.toBe(first);
});

it("после завершения операции та же нагрузка получает новую ссылку", () => {
  const operations = createRepeatableOperations();
  const payload = { email: "a@b.test", expectedRevision: 0 };
  const first = operations.operationId("contact-start", payload);

  operations.completeOperation("contact-start");

  // Иначе «отправить новый код» вернул бы прежний вызов и не отправил письмо.
  expect(operations.operationId("contact-start", payload)).not.toBe(first);
});

it("завершение одной операции не трогает остальные", () => {
  const operations = createRepeatableOperations();
  const quote = operations.operationId("quote", { optionId: "a" });
  operations.completeOperation("purchase");

  expect(operations.operationId("quote", { optionId: "a" })).toBe(quote);
});
