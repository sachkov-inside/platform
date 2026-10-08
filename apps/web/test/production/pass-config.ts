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
 * Product A — единственный опубликованный Product production с закрытыми материалами. Тело проверяется
 * на `bodyMaterialSlug`; картинку и задание даёт закрытый урок практики `practiceMaterialSlug`.
 * Материалы production проход не меняет.
 */
export const productA = {
  id: "625a0cca-c8ff-4a65-9125-17194dd3b769",
  slug: "ai-engineering",
  bodyMaterialSlug: "inside-content-aie-first-spec",
  practiceMaterialSlug: "inside-content-aie-project-setup",
} as const;

/** Бесплатная опубликованная практика: решение владельца 06.10.2026 в #938. */
export const freePracticeId = "inside-content:aie-github-app";

/**
 * Срок ручного AccessGrant identity `expired` (отчёт #905). До него клетки `expired` получают «не
 * проверено»: доступ ещё действует.
 */
export const expiredGrantEndsAt = "2026-10-05T07:08:00Z";

/** Второго Product в production нет: решение владельца в #905. */
export const productBDeferred = "отложено до второго Product";
/** Опубликованного видео в Product A нет: решение владельца в #906. */
export const videoDeferred = "отложено до первого видео Product A";

/** Read-only tools учебного MCP, которые проход вызывает; другой tool allowlist не пропустит. */
export const learnerMcpReadTools = [
  "learning_material_read",
  "learning_practice_read",
] as const;
/** Read-only tools владельческого MCP (`readOnlyHint: true`), которые проход вызывает. */
export const ownerMcpReadTools = ["billing_tiers_list"] as const;

// Роли Product переименованы в #1065; email существующих identities Logto остаются прежними (#1118).
const identityEmailAliases: Readonly<Record<PassIdentity, string>> = {
  "no-entitlement": "no-entitlement",
  "learner-product-a": "learner-guide-a",
  "learner-product-b": "learner-guide-b",
  expired: "expired",
  "materials-only": "materials-only",
  "billing-only": "billing-only",
};

/**
 * Email тестовой identity — алиас ящика владельца: `<ящик>+inside-access-<алиас>@<домен>`.
 * Сам ящик не хранится в репозитории: его даёт secret `PRODUCTION_ACCESS_MAILBOX`.
 */
export function identityEmail(mailbox: string, identity: PassIdentity): string {
  const at = mailbox.lastIndexOf("@");
  if (at <= 0 || mailbox.includes("+")) {
    throw new Error("PRODUCTION_ACCESS_MAILBOX must be a plain address");
  }
  return `${mailbox.slice(0, at)}+inside-access-${identityEmailAliases[identity]}${mailbox.slice(at)}`;
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
 * MCP, `owner-mcp` — владельческий MCP. Файл и видео learner MCP не отдаёт, поэтому их клетки только
 * браузерные. Пометка `deferred` — только решение владельца, не обход сбоя.
 */
export const passCells = [
  cell("anonymous/read-product-a/body@browser", "denied"),
  cell("anonymous/read-product-a/body@learner-mcp", "denied"),
  cell("anonymous/read-product-a/assets@browser", "denied"),
  cell("anonymous/read-product-a/video@browser", "denied", videoDeferred),
  cell("anonymous/read-product-a/practice@browser", "denied"),
  cell("anonymous/read-product-a/practice@learner-mcp", "denied"),

  cell("account-without-entitlement/read-product-a/body@browser", "denied"),
  cell("account-without-entitlement/read-product-a/body@learner-mcp", "denied"),
  cell("account-without-entitlement/read-product-a/assets@browser", "denied"),
  cell(
    "account-without-entitlement/read-product-a/video@browser",
    "denied",
    videoDeferred,
  ),
  cell("account-without-entitlement/read-product-a/practice@browser", "denied"),
  cell(
    "account-without-entitlement/read-product-a/practice@learner-mcp",
    "denied",
  ),

  cell(
    "account-without-entitlement/read-free-practice/practice@learner-mcp",
    "allowed",
  ),

  cell("learner-product-a/read-product-a/body@browser", "allowed"),
  cell("learner-product-a/read-product-a/body@learner-mcp", "allowed"),
  cell("learner-product-a/read-product-a/assets@browser", "allowed"),
  cell(
    "learner-product-a/read-product-a/video@browser",
    "allowed",
    videoDeferred,
  ),
  cell("learner-product-a/read-product-a/practice@browser", "allowed"),
  cell("learner-product-a/read-product-a/practice@learner-mcp", "allowed"),

  cell(
    "learner-product-a/read-product-b/body@browser",
    "denied",
    productBDeferred,
  ),
  cell(
    "learner-product-a/read-product-b/body@learner-mcp",
    "denied",
    productBDeferred,
  ),
  cell(
    "learner-product-a/read-product-b/assets@browser",
    "denied",
    productBDeferred,
  ),
  cell(
    "learner-product-a/read-product-b/video@browser",
    "denied",
    productBDeferred,
  ),
  cell(
    "learner-product-a/read-product-b/practice@browser",
    "denied",
    productBDeferred,
  ),
  cell(
    "learner-product-a/read-product-b/practice@learner-mcp",
    "denied",
    productBDeferred,
  ),

  cell(
    "learner-product-b/read-product-b/body@browser",
    "allowed",
    productBDeferred,
  ),
  cell(
    "learner-product-b/read-product-b/body@learner-mcp",
    "allowed",
    productBDeferred,
  ),
  cell(
    "learner-product-b/read-product-b/assets@browser",
    "allowed",
    productBDeferred,
  ),
  cell(
    "learner-product-b/read-product-b/video@browser",
    "allowed",
    productBDeferred,
  ),
  cell(
    "learner-product-b/read-product-b/practice@browser",
    "allowed",
    productBDeferred,
  ),
  cell(
    "learner-product-b/read-product-b/practice@learner-mcp",
    "allowed",
    productBDeferred,
  ),

  // Ученик B пока без доступа: его отказ на Product A наблюдается уже сейчас.
  cell("learner-product-b/read-product-a/body@browser", "denied"),
  cell("learner-product-b/read-product-a/body@learner-mcp", "denied"),
  cell("learner-product-b/read-product-a/assets@browser", "denied"),
  cell(
    "learner-product-b/read-product-a/video@browser",
    "denied",
    videoDeferred,
  ),
  cell("learner-product-b/read-product-a/practice@browser", "denied"),
  cell("learner-product-b/read-product-a/practice@learner-mcp", "denied"),

  cell("expired/read-product-a/body@browser", "denied"),
  cell("expired/read-product-a/body@learner-mcp", "denied"),
  cell("expired/read-product-a/assets@browser", "denied"),
  cell("expired/read-product-a/video@browser", "denied", videoDeferred),
  cell("expired/read-product-a/practice@browser", "denied"),
  cell("expired/read-product-a/practice@learner-mcp", "denied"),

  cell(
    "materials-only/manage-materials/materials-authoring@browser",
    "allowed",
  ),
  cell("materials-only/manage-billing/billing-operations@owner-mcp", "denied"),
  cell("billing-only/manage-billing/billing-operations@owner-mcp", "allowed"),
  cell("billing-only/manage-materials/materials-authoring@browser", "denied"),
] as const;
