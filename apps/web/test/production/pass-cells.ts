/**
 * Клетки production-прохода и итог job (#905). Логика чистая: она не ходит в сеть, поэтому её
 * доказывает module-тест `test/module/production-access-pass.test.ts`.
 *
 * Клетка с пометкой `deferred` пока не на чем проверить (решение владельца по #905: второго Guide в
 * production нет). Она видна в отчёте своим статусом и не делает job красным. Любая другая клетка
 * без наблюдения получает «не проверено» и делает job красным.
 */

export const passIdentities = [
  "no-entitlement",
  "learner-guide-a",
  "learner-guide-b",
  "expired",
  "materials-only",
  "billing-only",
] as const;
export type PassIdentity = (typeof passIdentities)[number];

export type PassSurface = "browser" | "learner-mcp";
export type PassOutcome = "allowed" | "denied";

export interface PassCell {
  readonly id: string;
  readonly identity: PassIdentity;
  readonly surface: PassSurface;
  readonly action: string;
  readonly expected: PassOutcome;
  /** Почему клетка пока не проверяется. Только решение владельца, не обход сбоя. */
  readonly deferred?: string;
}

export interface PassObservation {
  readonly cellId: string;
  readonly observed: PassOutcome;
}

export type PassCellStatus = "passed" | "failed" | "not_checked" | "deferred";

export interface PassCellResult {
  readonly id: string;
  readonly identity: PassIdentity;
  readonly surface: PassSurface;
  readonly action: string;
  readonly level: "production";
  readonly deployedSha: string;
  readonly expected: PassOutcome;
  readonly observed: PassOutcome | null;
  readonly status: PassCellStatus;
  readonly reason?: string;
}

export interface PassReport {
  readonly deployedSha: string;
  readonly verdict: "green" | "red";
  readonly cells: readonly PassCellResult[];
}

export function evaluatePass(input: {
  readonly cells: readonly PassCell[];
  readonly observations: readonly PassObservation[];
  readonly deployedSha: string;
}): PassReport {
  const known = new Set(input.cells.map((cell) => cell.id));
  const unknown = input.observations.find(({ cellId }) => !known.has(cellId));
  if (unknown !== undefined) {
    throw new Error(`Observation for unknown cell ${unknown.cellId}`);
  }
  const cells = input.cells.map((cell): PassCellResult => {
    const base = {
      id: cell.id,
      identity: cell.identity,
      surface: cell.surface,
      action: cell.action,
      level: "production" as const,
      deployedSha: input.deployedSha,
      expected: cell.expected,
    };
    if (cell.deferred !== undefined) {
      return {
        ...base,
        observed: null,
        status: "deferred",
        reason: cell.deferred,
      };
    }
    const observation = input.observations.find(
      ({ cellId }) => cellId === cell.id,
    );
    if (observation === undefined) {
      return { ...base, observed: null, status: "not_checked" };
    }
    return {
      ...base,
      observed: observation.observed,
      status: observation.observed === cell.expected ? "passed" : "failed",
    };
  });
  return {
    deployedSha: input.deployedSha,
    verdict: cells.every(
      ({ status }) => status === "passed" || status === "deferred",
    )
      ? "green"
      : "red",
    cells,
  };
}

const outcomeLabels: Record<PassOutcome, string> = {
  allowed: "доступ",
  denied: "отказ",
};

export function renderPassMarkdown(report: PassReport): string {
  const rows = report.cells.map((cell) =>
    [
      cell.id,
      cell.action,
      outcomeLabels[cell.expected],
      cell.observed === null ? "—" : outcomeLabels[cell.observed],
      statusLabel(cell),
    ].join(" | "),
  );
  return [
    "# Production-проход доступа",
    "",
    `Deployed SHA: \`${report.deployedSha}\``,
    "",
    `Итог: **${report.verdict === "green" ? "зелёный" : "красный"}**`,
    "",
    "| Клетка | Действие | Ожидание | Факт | Статус |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${row} |`),
    "",
  ].join("\n");
}

function statusLabel(cell: PassCellResult): string {
  switch (cell.status) {
    case "passed":
      return "совпало";
    case "failed":
      return "расхождение";
    case "not_checked":
      return "не проверено";
    case "deferred":
      return cell.reason ?? "отложено";
  }
}
