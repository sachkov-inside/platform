import type { PassCell, PassIdentity, PassOutcome } from "./pass-cells";

/**
 * Конфигурация production-прохода (#905, #906). Клетка называется `<строка матрицы>@<транспорт>`:
 * строка — `состояние/действие/поверхность` из матрицы проверок доступа
 * (`apps/backend/test/access-scenarios/access-check-matrix.ts`), и `pnpm check` требует здесь
 * клетку для каждой её production-строки. Перечень identities, вход и порядок замены секретов —
 * `docs/runbooks/production-test-identities.md`.
 */
export const productionTarget = {
  web: "https://inside.sachkov.dev",
  logto: "https://auth.sachkov.dev",
  learnerMcp: "https://inside.sachkov.dev/mcp/learning",
  ownerMcp: "https://inside.sachkov.dev/mcp",
  apiResource: "https://api.inside.sachkov.dev",
  managementResource: "https://default.logto.app/api",
} as const;

/**
 * Guide A — единственный опубликованный Guide production с закрытыми материалами. Тело проверяется
 * на `bodyMaterialSlug`; картинку и задание даёт закрытый урок практики `practiceMaterialSlug`.
 * Материалы production проход не меняет.
 */
export const guideA = {
  id: "625a0cca-c8ff-4a65-9125-17194dd3b769",
  slug: "ai-engineering",
  bodyMaterialSlug: "inside-content-aie-first-spec",
  practiceMaterialSlug: "inside-content-aie-project-setup",
} as const;

/**
 * Срок ручного AccessGrant identity `expired` (отчёт #905). До него клетки `expired` получают «не
 * проверено»: доступ ещё действует.
 */
export const expiredGrantEndsAt = "2026-10-05T07:08:00Z";

/** Второго Guide в production нет: решение владельца в #905. */
export const guideBDeferred = "отложено до второго Guide";
/** Опубликованного видео в Guide A нет: решение владельца в #906. */
export const videoDeferred = "отложено до первого видео Guide A";

/** Read-only tools учебного MCP, которые проход вызывает; другой tool allowlist не пропустит. */
export const learnerMcpReadTools = [
  "learning_material_read",
  "learning_practice_read",
] as const;
/** Read-only tools владельческого MCP (`readOnlyHint: true`), которые проход вызывает. */
export const ownerMcpReadTools = ["billing_tiers_list"] as const;

/**
 * Email тестовой identity — алиас ящика владельца: `<ящик>+inside-access-<identity>@<домен>`.
 * Сам ящик не хранится в репозитории: его даёт secret `PRODUCTION_ACCESS_MAILBOX`.
 */
export function identityEmail(mailbox: string, identity: PassIdentity): string {
  const at = mailbox.lastIndexOf("@");
  if (at <= 0 || mailbox.includes("+")) {
    throw new Error("PRODUCTION_ACCESS_MAILBOX must be a plain address");
  }
  return `${mailbox.slice(0, at)}+inside-access-${identity}${mailbox.slice(at)}`;
}

function cell<const Id extends string>(
  id: Id,
  expected: PassOutcome,
  deferred?: string,
): PassCell & { readonly id: Id } {
  return deferred === undefined ? { id, expected } : { id, expected, deferred };
}

/**
 * Клетки прохода. Транспорты: `browser` — Web/BFF под настоящей сессией, `learner-mcp` — учебный
 * MCP,
 * `owner-mcp` — владельческий MCP. Файл и видео learner MCP не отдаёт, поэтому их клетки только
 * браузерные. Пометка `deferred` — только решение владельца, не обход сбоя.
 */
export const passCells = [
  cell("anonymous/read-guide-a/body@browser", "denied"),
  cell("anonymous/read-guide-a/body@learner-mcp", "denied"),
  cell("anonymous/read-guide-a/assets@browser", "denied"),
  cell("anonymous/read-guide-a/video@browser", "denied", videoDeferred),
  cell("anonymous/read-guide-a/practice@browser", "denied"),
  cell("anonymous/read-guide-a/practice@learner-mcp", "denied"),

  cell("account-without-entitlement/read-guide-a/body@browser", "denied"),
  cell("account-without-entitlement/read-guide-a/body@learner-mcp", "denied"),
  cell("account-without-entitlement/read-guide-a/assets@browser", "denied"),
  cell(
    "account-without-entitlement/read-guide-a/video@browser",
    "denied",
    videoDeferred,
  ),
  cell("account-without-entitlement/read-guide-a/practice@browser", "denied"),
  cell(
    "account-without-entitlement/read-guide-a/practice@learner-mcp",
    "denied",
  ),

  cell("learner-guide-a/read-guide-a/body@browser", "allowed"),
  cell("learner-guide-a/read-guide-a/body@learner-mcp", "allowed"),
  cell("learner-guide-a/read-guide-a/assets@browser", "allowed"),
  cell("learner-guide-a/read-guide-a/video@browser", "allowed", videoDeferred),
  cell("learner-guide-a/read-guide-a/practice@browser", "allowed"),
  cell("learner-guide-a/read-guide-a/practice@learner-mcp", "allowed"),

  cell("learner-guide-a/read-guide-b/body@browser", "denied", guideBDeferred),
  cell(
    "learner-guide-a/read-guide-b/body@learner-mcp",
    "denied",
    guideBDeferred,
  ),
  cell("learner-guide-a/read-guide-b/assets@browser", "denied", guideBDeferred),
  cell("learner-guide-a/read-guide-b/video@browser", "denied", guideBDeferred),
  cell(
    "learner-guide-a/read-guide-b/practice@browser",
    "denied",
    guideBDeferred,
  ),
  cell(
    "learner-guide-a/read-guide-b/practice@learner-mcp",
    "denied",
    guideBDeferred,
  ),

  cell("learner-guide-b/read-guide-b/body@browser", "allowed", guideBDeferred),
  cell(
    "learner-guide-b/read-guide-b/body@learner-mcp",
    "allowed",
    guideBDeferred,
  ),
  cell(
    "learner-guide-b/read-guide-b/assets@browser",
    "allowed",
    guideBDeferred,
  ),
  cell("learner-guide-b/read-guide-b/video@browser", "allowed", guideBDeferred),
  cell(
    "learner-guide-b/read-guide-b/practice@browser",
    "allowed",
    guideBDeferred,
  ),
  cell(
    "learner-guide-b/read-guide-b/practice@learner-mcp",
    "allowed",
    guideBDeferred,
  ),

  // Ученик B пока без доступа: его отказ на Guide A наблюдается уже сейчас.
  cell("learner-guide-b/read-guide-a/body@browser", "denied"),
  cell("learner-guide-b/read-guide-a/body@learner-mcp", "denied"),
  cell("learner-guide-b/read-guide-a/assets@browser", "denied"),
  cell("learner-guide-b/read-guide-a/video@browser", "denied", videoDeferred),
  cell("learner-guide-b/read-guide-a/practice@browser", "denied"),
  cell("learner-guide-b/read-guide-a/practice@learner-mcp", "denied"),

  cell("expired/read-guide-a/body@browser", "denied"),
  cell("expired/read-guide-a/body@learner-mcp", "denied"),
  cell("expired/read-guide-a/assets@browser", "denied"),
  cell("expired/read-guide-a/video@browser", "denied", videoDeferred),
  cell("expired/read-guide-a/practice@browser", "denied"),
  cell("expired/read-guide-a/practice@learner-mcp", "denied"),

  cell(
    "materials-only/manage-materials/materials-authoring@browser",
    "allowed",
  ),
  cell("materials-only/manage-billing/billing-operations@owner-mcp", "denied"),
  cell("billing-only/manage-billing/billing-operations@owner-mcp", "allowed"),
  cell("billing-only/manage-materials/materials-authoring@browser", "denied"),
] as const;
