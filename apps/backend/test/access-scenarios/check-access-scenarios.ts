import {
  accessGrounds,
  accessSurfaces,
  accessTransitions,
  type AccessExpectation,
  type AccessScenarioTable,
  type AccessTerm,
} from "./access-scenarios.js";

/**
 * Контроль полноты таблицы: каждая клетка «что открывается × основание» и каждый переход описаны
 * ровно один раз, лишних имён нет, а неприменимая клетка объясняет почему. Возвращает список
 * нарушений; пустой список означает, что таблица покрывает модель целиком.
 */
export function checkAccessScenarioTable(table: AccessScenarioTable): readonly string[] {
  const expectedCells = accessSurfaces.flatMap((surface) => accessGrounds.map((ground) => `${surface}/${ground}`));
  const problems: string[] = [];
  for (const id of expectedCells) {
    if (!Object.hasOwn(table.cells, id)) problems.push(`missing cell ${id}`);
  }
  for (const id of Object.keys(table.cells)) {
    if (!expectedCells.includes(id)) problems.push(`unknown cell ${id}`);
    const expectation = table.cells[id];
    if (expectation?.outcome === "not-applicable" && expectation.because.trim().length === 0) {
      problems.push(`cell ${id} is not applicable without a reason`);
    }
  }
  for (const id of accessTransitions) {
    if (!Object.hasOwn(table.transitions, id)) problems.push(`missing transition ${id}`);
  }
  for (const [id, transition] of Object.entries(table.transitions)) {
    if (!(accessTransitions as readonly string[]).includes(id)) problems.push(`unknown transition ${id}`);
    if (transition.rule.trim().length === 0) problems.push(`transition ${id} has no rule`);
    if (Object.keys(transition.after).length === 0) problems.push(`transition ${id} observes nothing`);
  }
  return problems;
}

/** То, что сценарий наблюдал через публичный фасад, в словах таблицы. */
export type AccessObservation =
  | { readonly outcome: "open"; readonly term: AccessTerm }
  | { readonly outcome: "locked" }
  | { readonly outcome: "closed" };

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
  if (expectation.outcome !== observation.outcome) {
    return `${id} expected ${describe(expectation)} but observed ${describe(observation)}`;
  }
  if (expectation.outcome === "open" && observation.outcome === "open" && expectation.term !== observation.term) {
    return `${id} expected ${describe(expectation)} but observed ${describe(observation)}`;
  }
  return null;
}

function describe(value: AccessExpectation | AccessObservation): string {
  return value.outcome === "open" ? `open (${value.term})` : value.outcome;
}
