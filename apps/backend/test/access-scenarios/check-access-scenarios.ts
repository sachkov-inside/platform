import {
  accessCellId,
  accessGrounds,
  accessPublicationScenarios,
  accessPurchaseScenarios,
  accessSurfaces,
  accessTransitions,
  type AccessExpectation,
  type AccessScenarioTable,
  type AccessTerm,
  type CabinetView,
} from "./access-scenarios.js";

/**
 * Контроль полноты таблицы: каждая клетка «что открывается × основание», каждый переход, каждый
 * сценарий публикации и покупки описаны, лишних имён нет, а неприменимая клетка объясняет почему. Возвращает
 * список нарушений; пустой список означает, что таблица покрывает модель целиком.
 */
export function checkAccessScenarioTable(
  table: AccessScenarioTable,
): readonly string[] {
  const problems: string[] = [];
  for (const surface of accessSurfaces) {
    const row = table.cells[surface];
    for (const ground of accessGrounds) {
      if (row === undefined || !Object.hasOwn(row, ground))
        problems.push(`missing cell ${accessCellId(surface, ground)}`);
    }
  }
  for (const [surface, row] of Object.entries(table.cells)) {
    for (const [ground, expectation] of Object.entries(row)) {
      const id = accessCellId(surface, ground);
      if (
        !(accessSurfaces as readonly string[]).includes(surface) ||
        !(accessGrounds as readonly string[]).includes(ground)
      ) {
        problems.push(`unknown cell ${id}`);
      }
      if (
        expectation.outcome === "not-applicable" &&
        expectation.because.trim().length === 0
      ) {
        problems.push(`cell ${id} is not applicable without a reason`);
      }
    }
  }
  for (const id of accessTransitions) {
    if (!Object.hasOwn(table.transitions, id))
      problems.push(`missing transition ${id}`);
  }
  for (const [id, transition] of Object.entries(table.transitions)) {
    if (!(accessTransitions as readonly string[]).includes(id))
      problems.push(`unknown transition ${id}`);
    if (transition.rule.trim().length === 0)
      problems.push(`transition ${id} has no rule`);
    if (Object.keys(transition.after).length === 0)
      problems.push(`transition ${id} observes nothing`);
  }
  for (const id of accessPublicationScenarios) {
    if (!Object.hasOwn(table.publications, id))
      problems.push(`missing publication scenario ${id}`);
  }
  for (const [id, publication] of Object.entries(table.publications)) {
    if (!(accessPublicationScenarios as readonly string[]).includes(id))
      problems.push(`unknown publication scenario ${id}`);
    if (
      publication.rule.trim().length === 0 ||
      publication.rejectedWith.trim().length === 0
    ) {
      problems.push(`publication scenario ${id} has no rule or rejection`);
    }
  }
  for (const id of accessPurchaseScenarios) {
    if (!Object.hasOwn(table.purchases, id))
      problems.push(`missing purchase scenario ${id}`);
  }
  for (const [id, purchase] of Object.entries(table.purchases)) {
    if (!(accessPurchaseScenarios as readonly string[]).includes(id))
      problems.push(`unknown purchase scenario ${id}`);
    if (purchase.rule.trim().length === 0)
      problems.push(`purchase scenario ${id} has no rule`);
    if (
      purchase.kind === "admission" &&
      !purchase.listed &&
      purchase.rejectedWith === null
    )
      problems.push(`purchase scenario ${id} sells an Offer it does not list`);
  }
  return problems;
}

/** То, что сценарий наблюдал через публичный фасад, в словах таблицы. */
export type AccessObservation =
  | { readonly outcome: "open"; readonly term: AccessTerm }
  | { readonly outcome: "locked" }
  | { readonly outcome: "closed" }
  | { readonly outcome: "entry-closed" }
  | { readonly outcome: "by-tier" }
  | { readonly outcome: "shown"; readonly shows: CabinetView };

/**
 * Одно сравнение ожидания и наблюдения. Возвращает `null`, если они совпали, иначе объяснение
 * расхождения: сценарий падает с ним, а не с безымянным `toEqual`.
 */
export function compareAccessObservation(
  id: string,
  expectation: AccessExpectation,
  observation: AccessObservation,
): string | null {
  if (expectation.outcome === "not-applicable") {
    return `${id} is not applicable (${expectation.because}) but was observed as ${describe(observation)}`;
  }
  return describe(expectation) === describe(observation)
    ? null
    : `${id} expected ${describe(expectation)} but observed ${describe(observation)}`;
}

function describe(value: AccessExpectation | AccessObservation): string {
  switch (value.outcome) {
    case "open":
      return `open (${value.term})`;
    case "shown":
      return `shown (${value.shows})`;
    case "not-applicable":
      return "not-applicable";
    case "locked":
    case "closed":
    case "entry-closed":
    case "by-tier":
      return value.outcome;
  }
}
