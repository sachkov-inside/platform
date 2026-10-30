import { z } from "zod";

/**
 * Клетки production-прохода и итог job (#905, #906). Логика чистая: она не ходит в сеть, поэтому её
 * доказывает module-тест `test/module/production-access-pass.test.ts`.
 *
 * Клетка `deferred` видна отдельно от успешных наблюдений. Её owner policy действует только до
 * срока пересмотра и пока fixture не настроен. Неизвестный факт, неполная или устаревшая политика
 * делают job красным. Любая живая клетка без наблюдения получает «не проверено» и красный итог.
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
  readonly deferral?: {
    readonly owner: string;
    readonly reference: string;
    readonly fixture: string;
    readonly reviewBy: string;
  };
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
  "assets@browser": "картинка закрытого урока: байты с sachkov.dev",
  "video@browser": "основное видео: playback session и лицензия Kinescope",
  "practice@browser": "страница Product Task и код задания",
  "practice@learner-mcp": "часть 0 задания через learning_task_read",
  "materials-authoring@browser":
    "инструменты материалов: GET /api/authoring/materials",
  "billing-operations@owner-mcp": "цена Product A: billing_productPrices_list",
};
const actionLabels: Readonly<Record<string, string>> = {
  "read-product-a": "Product A",
  "read-product-b": "Product B",
  "read-free-practice": "Бесплатная практика",
  "read-free-lesson": "Бесплатный урок",
  "read-retired-practice": "Снятая с публикации практика",
  "manage-materials": "Materials",
  "manage-billing": "Billing",
};

/** Что проверяет клетка, словами отчёта. */
export function passCellCheck(id: string): string {
  const { action, surface, transport } = passCellParts(id);
  const check =
    action === "read-retired-practice"
      ? "learning_task_read не отдаёт контекст снятого задания"
      : action === "read-free-practice" &&
          surface === "practice" &&
          transport === "learner-mcp"
        ? "все закреплённые части через learning_task_read, SHA-256 и END_CONTEXT"
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
  readonly identity: PassIdentity | "anonymous";
  /** Клетка страницы, которая начала запрос; фоновые запросы без страницы клетки не имеют. */
  readonly cellId?: string | undefined;
  readonly method: string;
  /** Origin и путь без query: в query бывают токены. */
  readonly target: string;
  readonly reason: string;
  readonly sent?: true | undefined;
}

export type PassCellStatus = "passed" | "failed" | "not_checked" | "deferred";

export interface DeferralEvaluation {
  readonly status: "valid" | "ready" | "expired" | "invalid" | "unknown";
  readonly reason: string;
}

const deferralSchema = z
  .object({
    owner: z.string().trim().min(1),
    reference: z.string().regex(/^#[1-9][0-9]*$/u),
    fixture: z.enum(["product-b", "free-practice"]),
    reviewBy: z.iso.datetime(),
  })
  .strict();

function evaluateDeferral(
  cell: PassCell,
  facts: Readonly<Record<string, boolean>>,
  evaluatedAt: string,
): DeferralEvaluation {
  const policy = deferralSchema.safeParse(cell.deferral);
  if (
    !policy.success ||
    cell.deferred?.trim() === "" ||
    !Number.isFinite(Date.parse(evaluatedAt))
  )
    return {
      status: "invalid",
      reason: "неполная политика отсрочки или время проверки",
    };
  if (Date.parse(evaluatedAt) >= Date.parse(policy.data.reviewBy))
    return {
      status: "expired",
      reason: `требуется пересмотр отсрочки: срок ${policy.data.reviewBy} истёк`,
    };
  const available = facts[policy.data.fixture];
  if (typeof available !== "boolean")
    return {
      status: "unknown",
      reason: "нет проверенного факта fixture-конфигурации",
    };
  if (available)
    return {
      status: "ready",
      reason: "fixture настроен: требуется снять отсрочку и наблюдать клетку",
    };
  return {
    status: "valid",
    reason:
      "fixture не настроен; состояние публикации production автоматически не проверялось",
  };
}

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
  readonly deferral?: PassCell["deferral"];
  readonly deferralEvaluation?: DeferralEvaluation;
  readonly note?: string;
}

export interface PassReport {
  readonly sourceSha: string | null;
  readonly workflowSha: string | null;
  readonly evaluatedAt: string;
  readonly scope: "configured production access cells; Chromium, learner MCP and owner MCP";
  readonly counts: Readonly<
    Record<PassCellStatus | "skipped_excluded", number>
  > & { readonly total: number };
  readonly errors: readonly string[];
  readonly deployedSha: string | null;
  /** Проход после deploy обязан знать SHA выпуска; без него итог красный. */
  readonly deployedShaRequired: boolean;
  readonly verdict: "green" | "red";
  readonly cells: readonly PassCellResult[];
  readonly blockedRequests: readonly BlockedPassRequest[];
}

export function evaluatePass(input: {
  readonly cells: readonly PassCell[];
  readonly sourceSha?: string | null;
  readonly workflowSha?: string | null;
  readonly evaluatedAt?: string;
  readonly deferralFacts?: Readonly<Record<string, boolean>>;
  readonly observations: readonly PassObservation[];
  readonly problems?: readonly PassProblem[];
  readonly deployedSha: string | null;
  readonly deployedShaRequired?: boolean;
  readonly blockedRequests?: readonly BlockedPassRequest[];
}): PassReport {
  const known = new Set(input.cells.map((cell) => cell.id));
  const evaluatedAt = input.evaluatedAt ?? "";
  const errors: string[] = [];
  const sourceSha = input.sourceSha ?? null;
  const workflowSha = input.workflowSha ?? null;
  if (input.cells.length === 0) errors.push("empty configured scope");
  if (known.size !== input.cells.length)
    errors.push("duplicate configured cells");
  if (sourceSha === null || !/^[a-f0-9]{40}$/u.test(sourceSha))
    errors.push("missing or invalid source SHA");
  if (workflowSha !== null && !/^[a-f0-9]{40}$/u.test(workflowSha))
    errors.push("invalid workflow SHA");
  if (!z.iso.datetime().safeParse(evaluatedAt).success)
    errors.push("missing or invalid evaluation time");
  if (input.deployedSha !== null && !/^[a-f0-9]{40}$/u.test(input.deployedSha))
    errors.push("invalid deployed SHA");
  const observationIds = input.observations.map(({ cellId }) => cellId);
  if (new Set(observationIds).size !== observationIds.length)
    errors.push("duplicate observations");
  if (input.problems?.some(({ cellId }) => !known.has(cellId)) === true)
    errors.push("problem for unknown cell");
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
      const evaluation = evaluateDeferral(
        cell,
        input.deferralFacts ?? {},
        evaluatedAt,
      );
      const contradictory =
        input.observations.some(({ cellId }) => cellId === cell.id) ||
        input.problems?.some(({ cellId }) => cellId === cell.id) === true;
      return {
        ...base,
        observed: null,
        status:
          evaluation.status === "valid" && !contradictory
            ? "deferred"
            : "failed",
        reason: contradictory
          ? "отсроченная клетка содержит наблюдение или ошибку: требуется пересмотр"
          : evaluation.status === "valid"
            ? cell.deferred
            : evaluation.reason,
        ...(cell.deferral === undefined ? {} : { deferral: cell.deferral }),
        deferralEvaluation: evaluation,
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
      status:
        observation.observed === cell.expected &&
        input.problems?.some(({ cellId }) => cellId === cell.id) !== true
          ? "passed"
          : "failed",
      ...(observation.note === undefined ? {} : { note: observation.note }),
    };
  });
  const deployedShaRequired = input.deployedShaRequired ?? false;
  const blockedRequests = input.blockedRequests ?? [];
  const counts = {
    total: cells.length,
    passed: cells.filter(({ status }) => status === "passed").length,
    failed: cells.filter(({ status }) => status === "failed").length,
    not_checked: cells.filter(({ status }) => status === "not_checked").length,
    deferred: cells.filter(({ status }) => status === "deferred").length,
    // No configured-cell exclusion is authorized. Missing observations are not_checked.
    skipped_excluded: 0,
  };
  if (counts.passed === 0) errors.push("no successfully observed cells");
  const green =
    errors.length === 0 &&
    cells.every(({ status }) => status === "passed" || status === "deferred") &&
    (input.deployedSha !== null || !deployedShaRequired) &&
    blockedRequests.every(({ sent }) => sent !== true);
  return {
    sourceSha,
    workflowSha,
    evaluatedAt,
    scope:
      "configured production access cells; Chromium, learner MCP and owner MCP",
    counts,
    errors,
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
      cell.deferral === undefined
        ? ""
        : `${cell.deferral.owner}; ${cell.deferral.reference}; fixture ${cell.deferral.fixture}; review by ${cell.deferral.reviewBy}; ${cell.deferralEvaluation?.reason ?? ""}`,
    ].join(" | "),
  );
  const blocked = report.blockedRequests.map(
    ({ method, target, reason, sent, identity, cellId }) =>
      `- \`${method} ${target}\`: ${reason}${sent === true ? " — **отправлен**" : ""}; identity: \`${identity}\`${cellId === undefined ? "" : `; клетка: \`${cellId}\``}`,
  );
  return [
    "# Production-проход доступа",
    "",
    `Source SHA (checked-out runner): ${report.sourceSha === null ? "не передан" : `\`${report.sourceSha}\``}`,
    `Workflow SHA (GitHub context): ${report.workflowSha === null ? "не передан" : `\`${report.workflowSha}\``}`,
    `Deployed SHA: ${deployedShaLabel(report)}`,
    `Checked at: ${report.evaluatedAt}`,
    `Scope: ${report.scope}`,
    `Counts: total=${String(report.counts.total)}, passed=${String(report.counts.passed)}, failed=${String(report.counts.failed)}, not_checked=${String(report.counts.not_checked)}, skipped/excluded=${String(report.counts.skipped_excluded)}, deferred=${String(report.counts.deferred)}`,
    "Deferred и skipped/excluded не входят в passed. Полный доступ через Telegram и полный WebKit E2E этим проходом не проверяются.",
    ...report.errors.map((error) => `Ошибка отчёта: ${error}`),
    "",
    `Итог: **${report.verdict === "green" ? "зелёный" : "красный"}**`,
    "",
    "| Клетка | Проверка | Ожидание | Факт | Уровень | Статус | Отсрочка |",
    "|---|---|---|---|---|---|---|",
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
      return cell.reason === undefined
        ? "расхождение"
        : `ошибка: ${cell.reason}`;
    case "not_checked":
      return cell.reason === undefined
        ? "не проверено"
        : `не проверено: ${cell.reason}`;
    case "deferred":
      return cell.reason ?? "отложено";
  }
}
