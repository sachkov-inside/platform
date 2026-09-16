import { describe, expect, test } from "vitest";

import {
  accessGrounds,
  accessPublicationScenarios,
  accessScenarioTable,
  accessSurfaces,
  accessTransitions,
} from "../access-scenarios/access-scenarios.js";
import { checkAccessScenarioTable, compareAccessObservation } from "../access-scenarios/check-access-scenarios.js";
import { divergentExpectation, incompleteAccessScenarioTable } from "../access-scenarios/fixtures/broken-access-scenarios.js";

describe("таблица сценариев доступа", () => {
  test("описывает каждую клетку «что открывается × основание», каждый переход и сценарий публикации", () => {
    expect(checkAccessScenarioTable(accessScenarioTable)).toEqual([]);
    const cells = Object.values(accessScenarioTable.cells).flatMap((row) => Object.keys(row));
    expect(cells).toHaveLength(accessSurfaces.length * accessGrounds.length);
    expect(Object.keys(accessScenarioTable.transitions)).toHaveLength(accessTransitions.length);
    expect(Object.keys(accessScenarioTable.publications)).toHaveLength(accessPublicationScenarios.length);
  });

  test("пропущенные клетка, переход и публикация, лишнее имя и неприменимость без причины роняют контроль", () => {
    expect(checkAccessScenarioTable(incompleteAccessScenarioTable)).toEqual([
      "missing cell support/one-time-purchase",
      "unknown cell support/gift-certificate",
      "cell mcp/guest is not applicable without a reason",
      "missing transition guide-archived",
      "missing publication scenario standalone-membership-publication-rejected",
    ]);
  });

  test("расхождение ожидания с наблюдаемым доступом называется по имени клетки", () => {
    expect(compareAccessObservation(divergentExpectation.id, divergentExpectation.expectation, divergentExpectation.observation))
      .toBe("product-material/withdrawal-refund expected open (lifetime) but observed locked");
    expect(compareAccessObservation("support/one-time-purchase", { outcome: "open", term: "six-months" }, { outcome: "open", term: "lifetime" }))
      .toBe("support/one-time-purchase expected open (six-months) but observed open (lifetime)");
    expect(compareAccessObservation("community-chat/expired-or-revoked", { outcome: "entry-closed" }, { outcome: "closed" }))
      .toBe("community-chat/expired-or-revoked expected entry-closed but observed closed");
    expect(compareAccessObservation("cabinet/withdrawal-refund", { outcome: "shown", shows: "purchase-history" }, { outcome: "shown", shows: "nothing" }))
      .toBe("cabinet/withdrawal-refund expected shown (purchase-history) but observed shown (nothing)");
    expect(compareAccessObservation("mcp/guest", { outcome: "not-applicable", because: "Нет Account" }, { outcome: "closed" }))
      .toBe("mcp/guest is not applicable (Нет Account) but was observed as closed");
    expect(compareAccessObservation("support/tier-via-course", { outcome: "by-tier" }, { outcome: "by-tier" })).toBeNull();
  });
});
