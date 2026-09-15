/**
 * Таблица сценариев доступа к контенту Inside: что открывается и на каком основании.
 *
 * Это исполняемая форма модели доступа. Каждая клетка «что открывается × основание» и каждый
 * переход имеет стабильное имя (`product-material/one-time-purchase`, `refund`), на которое
 * ссылаются документы. Полноту таблицы держат тип и контроль в `pnpm check`
 * (`test/unit/access-scenario-table.test.ts`), а поведение каждой клетки и перехода — сценарии
 * через публичные фасады на PostgreSQL (`test/integration/access-scenarios.test.ts`).
 *
 * Меняя правило доступа, меняют ожидание здесь; пропуск клетки не проходит ни typecheck, ни
 * контроль полноты, а расхождение с поведением роняет сценарий.
 */

/** Основание, на котором человек приходит к контенту. */
export const accessGrounds = [
  "guest",
  "account-without-rights",
  "one-time-purchase",
  "tier-via-course",
  "tier-via-tribute",
  "manual-assignment",
  "hidden-active-tier",
  "expired-or-revoked",
  "multiple-grounds",
  "withdrawal-refund",
] as const;
export type AccessGround = (typeof accessGrounds)[number];

/** Что открывается. */
export const accessSurfaces = [
  "public-material",
  "product-material",
  "programme",
  "artifacts",
  "video",
  "community-chat",
  "support",
  "cabinet",
  "author",
  "mcp",
] as const;
export type AccessSurface = (typeof accessSurfaces)[number];

/** Изменение, после которого доступ обязан перейти в новое состояние. */
export const accessTransitions = [
  "expiry",
  "revocation",
  "refund",
  "tier-composition-change",
  "tier-archived-with-assignments",
  "material-removed-from-product",
  "guide-archived",
] as const;
export type AccessTransition = (typeof accessTransitions)[number];

/** Стабильное имя клетки для документов и сообщений о расхождении. */
export function accessCellId(surface: string, ground: string): string {
  return `${surface}/${ground}`;
}

/**
 * Срок открытого доступа: публично, навсегда, пока действует основание, шесть месяцев
 * сопровождения с покупки или пока у Account есть разрешение автора.
 */
export type AccessTerm = "public" | "lifetime" | "ground-term" | "six-months" | "permission";

export type AccessExpectation =
  | { readonly outcome: "open"; readonly term: AccessTerm }
  /** Ресурс виден (карточка, программа, метаданные), но содержимое закрыто. */
  | { readonly outcome: "locked" }
  | { readonly outcome: "closed" }
  | { readonly outcome: "not-applicable"; readonly because: string };

export interface AccessTransitionScenario {
  /** Правило перехода словами владельца модели. */
  readonly rule: string;
  /** Что открыто после перехода у затронутого основания. */
  readonly after: Readonly<Partial<Record<AccessSurface, AccessExpectation>>>;
}

/** Форма, которую читает контроль полноты: он не доверяет типу и проверяет каждое имя. */
export interface AccessScenarioTable {
  readonly cells: Readonly<Record<string, Readonly<Record<string, AccessExpectation>>>>;
  readonly transitions: Readonly<Record<string, AccessTransitionScenario>>;
}

type ByGround = Readonly<Record<AccessGround, AccessExpectation>>;

const open = (term: AccessTerm): AccessExpectation => ({ outcome: "open", term });
const locked: AccessExpectation = { outcome: "locked" };
const closed: AccessExpectation = { outcome: "closed" };
const notApplicable = (because: string): AccessExpectation => ({ outcome: "not-applicable", because });

/** Одно ожидание для каждого основания. */
function everyGround(expectation: AccessExpectation): ByGround {
  return {
    "guest": expectation,
    "account-without-rights": expectation,
    "one-time-purchase": expectation,
    "tier-via-course": expectation,
    "tier-via-tribute": expectation,
    "manual-assignment": expectation,
    "hidden-active-tier": expectation,
    "expired-or-revoked": expectation,
    "multiple-grounds": expectation,
    "withdrawal-refund": expectation,
  };
}

/** Основание одинаково открывает материал руководства, замки его программы и артефакты. */
const productContent: ByGround = {
  "guest": locked,
  "account-without-rights": locked,
  "one-time-purchase": open("lifetime"),
  "tier-via-course": open("lifetime"),
  "tier-via-tribute": open("ground-term"),
  "manual-assignment": open("ground-term"),
  "hidden-active-tier": open("ground-term"),
  "expired-or-revoked": locked,
  "multiple-grounds": open("lifetime"),
  "withdrawal-refund": locked,
};

const withoutAccount = "Без входа нет Account, у которого это можно проверить";

export const accessScenarioTable = {
  cells: {
    // Публичный материал открыт всем, какое бы основание ни было.
    "public-material": everyGround(open("public")),
    // Закрытый материал живёт внутри руководства; вне права виден только его тизер.
    "product-material": productContent,
    // Программа руководства видна всем, замки на материалах следуют праву.
    "programme": productContent,
    // Закрытый артефакт показывает метаданные, а файл отдаёт только по праву на руководство.
    "artifacts": productContent,
    // Видео закрытого материала не имеет тизера: без права сессия не выдаётся.
    "video": { ...productContent, "guest": closed, "account-without-rights": closed, "expired-or-revoked": closed, "withdrawal-refund": closed },
    // Общий чат открывает купленное руководство и тариф с `community`; срок — самое длинное основание.
    "community-chat": {
      "guest": closed,
      "account-without-rights": closed,
      "one-time-purchase": open("lifetime"),
      "tier-via-course": open("lifetime"),
      "tier-via-tribute": open("ground-term"),
      "manual-assignment": open("ground-term"),
      "hidden-active-tier": open("ground-term"),
      "expired-or-revoked": closed,
      "multiple-grounds": open("lifetime"),
      "withdrawal-refund": closed,
    },
    // Сопровождение даёт только предложение продукта: шесть месяцев с покупки. Тарифы курса и
    // Tribute сопровождения не содержат.
    "support": {
      ...everyGround(closed),
      "one-time-purchase": open("six-months"),
      "multiple-grounds": open("six-months"),
    },
    // Кабинет показывает действующие основания; истёкшее, отозванное и возвращённое не показывает.
    "cabinet": {
      "guest": notApplicable(withoutAccount),
      "account-without-rights": closed,
      "one-time-purchase": open("lifetime"),
      "tier-via-course": open("lifetime"),
      "tier-via-tribute": open("ground-term"),
      "manual-assignment": open("ground-term"),
      "hidden-active-tier": open("ground-term"),
      "expired-or-revoked": closed,
      "multiple-grounds": open("lifetime"),
      "withdrawal-refund": closed,
    },
    // Автор с `materials:manage` читает закрытый материал независимо от своего основания.
    "author": {
      ...everyGround(open("permission")),
      "guest": notApplicable("Автор — это Account с разрешением; у гостя его нет"),
    },
    // MCP читает материал только для Account с `materials:manage`; право читателя его не открывает.
    "mcp": {
      ...everyGround(closed),
      "guest": notApplicable("MCP принимает только делегированный токен Account"),
    },
  } satisfies Record<AccessSurface, ByGround>,
  transitions: {
    "expiry": {
      rule: "Истёк срок основания: материалы, артефакты, видео и чат этого основания закрываются, другие основания не затрагиваются.",
      after: { "product-material": locked, "video": closed, "community-chat": closed },
    },
    "revocation": {
      rule: "Владелец отозвал назначение: доступ закрывается сразу, уже выданная сессия видео больше не принимается.",
      after: { "product-material": locked, "video": closed, "community-chat": closed },
    },
    "refund": {
      rule: "Возврат по отказу отзывает оплаченные права покупки: материалы, сопровождение и чат закрываются, независимое основание остаётся.",
      after: { "product-material": locked, "support": closed, "community-chat": closed },
    },
    "tier-composition-change": {
      rule: "Новая редакция состава тарифа не меняет действующие назначения, пока владелец явно не расширит их.",
      after: { "product-material": open("ground-term") },
    },
    "tier-archived-with-assignments": {
      rule: "Архив тарифа снимает его с продажи и назначения навсегда, а действующие назначения сохраняют доступ.",
      after: { "product-material": open("ground-term") },
    },
    "material-removed-from-product": {
      rule: "Материал уходит из купленного руководства только подтверждённым снятием с записью в журнал; после снятия он закрыт для купивших.",
      after: { "product-material": locked },
    },
    "guide-archived": {
      rule: "Архивное руководство уходит с витрины, у имеющих право сохраняются программа и материалы.",
      after: { "programme": open("lifetime"), "product-material": open("lifetime") },
    },
  } satisfies Record<AccessTransition, AccessTransitionScenario>,
} as const satisfies AccessScenarioTable;
