import type { PassCell, PassIdentity } from "./pass-cells";

/**
 * Конфигурация минимального production-прохода (#905). Полный набор клеток добавляет #906.
 * Перечень identities, вход и порядок замены секретов —
 * `docs/runbooks/production-test-identities.md`.
 */
export const productionTarget = {
  web: "https://inside.sachkov.dev",
  logto: "https://auth.sachkov.dev",
  learnerMcp: "https://inside.sachkov.dev/mcp/learning",
  apiResource: "https://api.inside.sachkov.dev",
  managementResource: "https://default.logto.app/api",
} as const;

/**
 * Guide A — единственный опубликованный Guide production с закрытыми материалами. Второго Guide
 * нет, поэтому клетки Guide B отложены решением владельца по #905 (комментарий в задаче).
 */
export const guideA = {
  id: "625a0cca-c8ff-4a65-9125-17194dd3b769",
  slug: "ai-engineering",
  protectedMaterialSlug: "inside-content-aie-first-spec",
} as const;
export const guideBDeferred = "отложено до второго Guide";

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

export const passCells = [
  {
    id: "learner-guide-a/learner-mcp/guide-a-body",
    identity: "learner-guide-a",
    surface: "learner-mcp",
    action: "Читает защищённое тело материала Guide A",
    expected: "allowed",
  },
  {
    id: "learner-guide-a/browser/guide-a-body",
    identity: "learner-guide-a",
    surface: "browser",
    action: "Читает защищённое тело материала Guide A",
    expected: "allowed",
  },
  {
    id: "learner-guide-a/learner-mcp/guide-b-body",
    identity: "learner-guide-a",
    surface: "learner-mcp",
    action: "Не получает закрытых bytes материала Guide B",
    expected: "denied",
    deferred: guideBDeferred,
  },
  {
    id: "learner-guide-a/browser/guide-b-body",
    identity: "learner-guide-a",
    surface: "browser",
    action: "Не получает закрытых bytes материала Guide B",
    expected: "denied",
    deferred: guideBDeferred,
  },
  {
    id: "no-entitlement/learner-mcp/guide-a-body",
    identity: "no-entitlement",
    surface: "learner-mcp",
    action: "Не получает закрытых bytes материала Guide A",
    expected: "denied",
  },
  {
    id: "no-entitlement/browser/guide-a-body",
    identity: "no-entitlement",
    surface: "browser",
    action: "Не получает закрытых bytes материала Guide A",
    expected: "denied",
  },
] as const satisfies readonly PassCell[];
