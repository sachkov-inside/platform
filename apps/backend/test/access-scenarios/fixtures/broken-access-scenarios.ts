import { accessScenarioTable, type AccessScenarioTable } from "../access-scenarios.js";

/**
 * Негативные фикстуры таблицы сценариев. Они доказывают, что контроль ловит нарушение, а не
 * пропускает всё подряд: без них зелёная проверка ничего бы не значила.
 */

const { "support/one-time-purchase": _missing, ...cellsWithoutOne } = accessScenarioTable.cells;
const { "guide-archived": _missingTransition, ...transitionsWithoutOne } = accessScenarioTable.transitions;

/** Пропущена клетка и переход, добавлено несуществующее основание, n/a без причины. */
export const incompleteAccessScenarioTable: AccessScenarioTable = {
  cells: {
    ...cellsWithoutOne,
    "support/gift-certificate": { outcome: "open", term: "lifetime" },
    "mcp/guest": { outcome: "not-applicable", because: " " },
  },
  transitions: transitionsWithoutOne,
};

/** Ожидание, которое расходится с моделью: возврат по отказу якобы оставляет материал открытым. */
export const divergentExpectation = {
  id: "product-material/withdrawal-refund",
  expectation: { outcome: "open", term: "lifetime" },
  observation: { outcome: "locked" },
} as const;
