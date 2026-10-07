/**
 * Клетки production-прохода и итог job (#905, #906). Логика чистая: она не ходит в сеть, поэтому её
 * доказывает module-тест `test/module/production-access-pass.test.ts`.
 *
 * Клетка с пометкой `deferred` пока не на чем проверить (решения владельца в #905 и #906). Она
 * видна в отчёте своим статусом и не делает job красным. Любая другая клетка без наблюдения
 * получает «не проверено» и делает job красным.
 */

export const passIdentities = [
  "no-entitlement",
  "learner-product-a",
  "learner-product-b",
  "expired",
  "materials-only",
  "billing-only",
] as const;
export type PassIdentity = (typeof passIdentities)[number];

export type PassTransport = "browser" | "learner-mcp" | "owner-mcp";
export type PassOutcome = "allowed" | "denied";

/** Клетка `<состояние>/<действие>/<поверхность>@<транспорт>`: строка матрицы и транспорт. */
export interface PassCell {
  readonly id: string;
  readonly expected: PassOutcome;
  /** Почему клетка пока не проверяется. Только решение владельца, не обход сбоя. */
  readonly deferred?: string;
}

export interface PassCellParts {
  readonly state: string;
  readonly action: string;
  readonly surface: string;
  readonly transport: PassTransport;
  /** Identity, которой входит проход; `anonymous` входа не имеет. */
  readonly identity: PassIdentity | "anonymous";
}

const stateIdentities: Readonly<Record<string, PassIdentity | "anonymous">> = {
  anonymous: "anonymous",
  "account-without-entitlement": "no-entitlement",
  "learner-product-a": "learner-product-a",
  "learner-product-b": "learner-product-b",
  expired: "expired",
  "materials-only": "materials-only",
  "billing-only": "billing-only",
};
const transports: readonly PassTransport[] = [
  "browser",
  "learner-mcp",
  "owner-mcp",
];

export function passCellParts(id: string): PassCellParts {
  const match = /^([a-z-]+)\/([a-z-]+)\/([a-z-]+)@([a-z-]+)$/u.exec(id);
  const [, state, action, surface, transport] = match ?? [];
  const identity = state === undefined ? undefined : stateIdentities[state];
  const knownTransport = transports.find((known) => known === transport);
  if (
    action === undefined ||
    surface === undefined ||
    identity === undefined ||
    knownTransport === undefined
  ) {
    throw new Error(`Malformed pass cell ${id}`);
  }
  return {
    state: state ?? "",
    action,
    surface,
    transport: knownTransport,
    identity,
  };
}

const surfaceChecks: Readonly<Record<string, string>> = {
  "body@browser": "закрытое тело урока в HTML и данных RSC страницы",
  "body@learner-mcp": "закрытое тело урока через learning_material_read",
  "assets@browser": "картинка закрытого урока: redirect на хранилище",
  "video@browser": "основное видео: playback session",
  "practice@browser": "блок «Проверка практики» и id задания на странице урока",
  "practice@learner-mcp": "часть 0 задания через learning_practice_read",
  "materials-authoring@browser":
    "инструменты материалов: GET /api/authoring/materials",
  "billing-operations@owner-mcp": "каталог тарифов: billing_tiers_list",
};
const actionLabels: Readonly<Record<string, string>> = {
  "read-product-a": "Product A",
  "read-product-b": "Product B",
  "read-free-practice": "Бесплатная практика",
  "manage-materials": "Materials",
  "manage-billing": "Billing",
};

/** Что проверяет клетка, словами отчёта. */
export function passCellCheck(id: string): string {
  const { action, surface, transport } = passCellParts(id);
  const check =
    action === "read-free-practice" &&
    surface === "practice" &&
    transport === "learner-mcp"
      ? "все закреплённые части через learning_practice_read, SHA-256 и END_CONTEXT"
      : surfaceChecks[`${surface}@${transport}`];
  if (check === undefined) throw new Error(`No check for pass cell ${id}`);
  return `${actionLabels[action] ?? action}: ${check}`;
}

export interface PassObservation {
  readonly cellId: string;
  readonly observed: PassOutcome;
  /** Короткий факт без адресов, токенов и email: код ответа или ошибки. */
  readonly note?: string | undefined;
}

/** Почему клетку не удалось наблюдать: первая строка ошибки теста, очищенная от секретов. */
export interface PassProblem {
  readonly cellId: string;
  readonly problem: string;
}

/**
 * Запрос вне allowlist. Обычно раннер его не отправил. `sent: true` — шаг redirect в браузере,
 * который Playwright не даёт перехватить: он ушёл, и итог прохода красный.
 */
export interface BlockedPassRequest {
  readonly method: string;
  /** Origin и путь без query: в query бывают токены. */
  readonly target: string;
  readonly reason: string;
  readonly sent?: true | undefined;
}

export type PassCellStatus = "passed" | "failed" | "not_checked" | "deferred";

export interface PassCellResult {
  readonly id: string;
  readonly identity: PassIdentity | "anonymous";
  readonly transport: PassTransport;
  readonly check: string;
  readonly level: "production";
  readonly deployedSha: string | null;
  readonly expected: PassOutcome;
  readonly observed: PassOutcome | null;
  readonly status: PassCellStatus;
  readonly reason?: string;
  readonly note?: string;
}

export interface PassReport {
  readonly deployedSha: string | null;
  /** Проход после deploy обязан знать SHA выпуска; без него итог красный. */
  readonly deployedShaRequired: boolean;
  readonly verdict: "green" | "red";
  readonly cells: readonly PassCellResult[];
  readonly blockedRequests: readonly BlockedPassRequest[];
}

export function evaluatePass(input: {
  readonly cells: readonly PassCell[];
  readonly observations: readonly PassObservation[];
  readonly problems?: readonly PassProblem[];
  readonly deployedSha: string | null;
  readonly deployedShaRequired?: boolean;
  readonly blockedRequests?: readonly BlockedPassRequest[];
}): PassReport {
  const known = new Set(input.cells.map((cell) => cell.id));
  const unknown = input.observations.find(({ cellId }) => !known.has(cellId));
  if (unknown !== undefined) {
    throw new Error(`Observation for unknown cell ${unknown.cellId}`);
  }
  const cells = input.cells.map((cell): PassCellResult => {
    const { identity, transport } = passCellParts(cell.id);
    const base = {
      id: cell.id,
      identity,
      transport,
      check: passCellCheck(cell.id),
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
      const problem = input.problems?.find(({ cellId }) => cellId === cell.id);
      return {
        ...base,
        observed: null,
        status: "not_checked",
        ...(problem === undefined ? {} : { reason: problem.problem }),
      };
    }
    return {
      ...base,
      observed: observation.observed,
      status: observation.observed === cell.expected ? "passed" : "failed",
      ...(observation.note === undefined ? {} : { note: observation.note }),
    };
  });
  const deployedShaRequired = input.deployedShaRequired ?? false;
  const blockedRequests = input.blockedRequests ?? [];
  const green =
    cells.every(({ status }) => status === "passed" || status === "deferred") &&
    (input.deployedSha !== null || !deployedShaRequired) &&
    blockedRequests.every(({ sent }) => sent !== true);
  return {
    deployedSha: input.deployedSha,
    deployedShaRequired,
    verdict: green ? "green" : "red",
    cells,
    blockedRequests,
  };
}

const outcomeLabels: Record<PassOutcome, string> = {
  allowed: "доступ",
  denied: "отказ",
};

export function renderPassMarkdown(report: PassReport): string {
  const rows = report.cells.map((cell) =>
    [
      `\`${cell.id}\``,
      cell.check,
      outcomeLabels[cell.expected],
      cell.observed === null
        ? "—"
        : `${outcomeLabels[cell.observed]}${cell.note === undefined ? "" : ` (${cell.note})`}`,
      cell.level,
      statusLabel(cell),
    ].join(" | "),
  );
  const blocked = report.blockedRequests.map(
    ({ method, target, reason, sent }) =>
      `- \`${method} ${target}\`: ${reason}${sent === true ? " — **отправлен**" : ""}`,
  );
  return [
    "# Production-проход доступа",
    "",
    `Deployed SHA: ${deployedShaLabel(report)}`,
    "",
    `Итог: **${report.verdict === "green" ? "зелёный" : "красный"}**`,
    "",
    "| Клетка | Проверка | Ожидание | Факт | Уровень | Статус |",
    "|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row} |`),
    "",
    "## Запросы вне allowlist",
    "",
    ...(blocked.length === 0 ? ["Нет."] : blocked),
    "",
  ].join("\n");
}

function deployedShaLabel(report: PassReport): string {
  if (report.deployedSha !== null) return `\`${report.deployedSha}\``;
  return report.deployedShaRequired
    ? "не передан, а после deploy обязателен"
    : "не передан";
}

function statusLabel(cell: PassCellResult): string {
  switch (cell.status) {
    case "passed":
      return "совпало";
    case "failed":
      return "расхождение";
    case "not_checked":
      return cell.reason === undefined
        ? "не проверено"
        : `не проверено: ${cell.reason}`;
    case "deferred":
      return cell.reason ?? "отложено";
  }
}
