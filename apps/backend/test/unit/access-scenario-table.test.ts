import { describe, expect, test } from "vitest";

import { accessGrounds, accessScenarioTable, accessSurfaces, accessTransitions } from "../access-scenarios/access-scenarios.js";
import { checkAccessScenarioTable, compareAccessObservation } from "../access-scenarios/check-access-scenarios.js";
import { divergentExpectation, incompleteAccessScenarioTable } from "../access-scenarios/fixtures/broken-access-scenarios.js";

describe("таблица сценариев доступа", () => {
  test("описывает каждую клетку «что открывается × основание» и каждый переход", () => {
    expect(checkAccessScenarioTable(accessScenarioTable)).toEqual([]);
    expect(Object.keys(accessScenarioTable.cells)).toHaveLength(accessSurfaces.length * accessGrounds.length);
    expect(Object.keys(accessScenarioTable.transitions)).toHaveLength(accessTransitions.length);
  });

  test("пропущенная клетка, лишнее имя и неприменимость без причины роняют контроль", () => {
    expect(checkAccessScenarioTable(incompleteAccessScenarioTable)).toEqual([
      "missing cell support/one-time-purchase",
      "cell mcp/guest is not applicable without a reason",
      "unknown cell support/gift-certificate",
      "missing transition guide-archived",
    ]);
  });

  test("расхождение ожидания с наблюдаемым доступом называется по имени клетки", () => {
    expect(compareAccessObservation(divergentExpectation.id, divergentExpectation.expectation, divergentExpectation.observation))
      .toBe("product-material/withdrawal-refund expected open (lifetime) but observed locked");
    expect(compareAccessObservation("support/one-time-purchase", { outcome: "open", term: "six-months" }, { outcome: "open", term: "lifetime" }))
      .toBe("support/one-time-purchase expected open (six-months) but observed open (lifetime)");
    expect(compareAccessObservation("mcp/guest", { outcome: "not-applicable", because: "Нет Account" }, { outcome: "closed" }))
      .toBe("mcp/guest is not applicable (Нет Account) but was observed as closed");
    expect(compareAccessObservation("video/guest", { outcome: "closed" }, { outcome: "closed" })).toBeNull();
  });
});
