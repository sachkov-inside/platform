import { accessScenarioTable, type AccessScenarioTable } from "../access-scenarios.js";

/**
 * Негативные фикстуры таблицы сценариев. Они доказывают, что контроль ловит нарушение, а не
 * пропускает всё подряд: без них зелёная проверка ничего бы не значила.
 */

const { "one-time-purchase": _missing, ...supportWithoutPurchase } = accessScenarioTable.cells.support;
const { "guide-archived": _missingTransition, ...transitionsWithoutOne } = accessScenarioTable.transitions;

/** Пропущены клетка и переход, добавлено несуществующее основание, n/a без причины. */
export const incompleteAccessScenarioTable: AccessScenarioTable = {
  cells: {
    ...accessScenarioTable.cells,
    "support": { ...supportWithoutPurchase, "gift-certificate": { outcome: "open", term: "lifetime" } },
    "mcp": { ...accessScenarioTable.cells.mcp, "guest": { outcome: "not-applicable", because: " " } },
  },
  transitions: transitionsWithoutOne,
};

/** Ожидание, которое расходится с моделью: возврат по отказу якобы оставляет материал открытым. */
export const divergentExpectation = {
  id: "product-material/withdrawal-refund",
  expectation: { outcome: "open", term: "lifetime" },
  observation: { outcome: "locked" },
} as const;
