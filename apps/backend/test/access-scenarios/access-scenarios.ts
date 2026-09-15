/**
 * Таблица сценариев доступа к контенту Inside: что открывается и на каком основании.
 *
 * Это исполняемая форма канонической модели доступа (Workspace `product/access-model.md`). Каждая
 * клетка «что открывается × основание», каждый переход и сценарий публикации имеет то же имя, что
 * в модели: `product-material/one-time-purchase`, `refund`, `standalone-membership-publication-rejected`.
 * Полноту держат тип и контроль в `pnpm check` (`test/unit/access-scenario-table.test.ts`), а
 * поведение — сценарии через публичные фасады на PostgreSQL (`test/integration/access-scenarios.test.ts`).
 *
 * Новое правило доступа сначала меняет модель, затем ожидание здесь; пропуск клетки не проходит ни
 * typecheck, ни контроль полноты, а расхождение с поведением роняет сценарий.
 */

/** Основание, на котором человек приходит к контенту. Столбцы модели. */
export const accessGrounds = [
  "guest",
  "account-without-rights",
  "one-time-purchase",
  "tier-via-course",
  "tier-via-tribute",
  "manual-assignment",
  "hidden-active-tier",
  "direct",
  "expired-or-revoked",
  "multiple-grounds",
  "withdrawal-refund",
  "moderation",
] as const;
export type AccessGround = (typeof accessGrounds)[number];

/** Что открывается. Строки модели и субъекты «автор» и «агент через MCP». */
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
  "bridge-replaced-by-tribute",
  "tribute-temporary-source-lost",
  "refund",
  "refund-without-withdrawal",
  "support-kept-by-other-ground",
  "material-added-to-product",
  "material-removed-from-product",
  "guide-archived",
  "tier-composition-change",
  "tier-archived-with-assignments",
] as const;
export type AccessTransition = (typeof accessTransitions)[number];

/** Правила публикации, без которых модель «закрытое живёт внутри продуктов» не держится. */
export const accessPublicationScenarios = ["standalone-membership-publication-rejected"] as const;
export type AccessPublicationScenario = (typeof accessPublicationScenarios)[number];

/** Стабильное имя клетки для документов и сообщений о расхождении. */
export function accessCellId(surface: string, ground: string): string {
  return `${surface}/${ground}`;
}

/**
 * Срок открытого доступа: публично, без даты окончания, пока действует основание, шесть месяцев
 * сопровождения с покупки или пока у Account есть разрешение автора.
 */
export type AccessTerm = "public" | "lifetime" | "ground-term" | "six-months" | "permission";

/** Что кабинет показывает человеку о его основаниях. */
export type CabinetView = "nothing" | "active" | "all-grounds" | "ended" | "purchase-history" | "restriction";

export type AccessExpectation =
  | { readonly outcome: "open"; readonly term: AccessTerm }
  /** Виден тизер или описание (название, назначение, обложка), но не содержимое. */
  | { readonly outcome: "locked" }
  | { readonly outcome: "closed" }
  /** Права на чат нет и новый вход закрыт; из чата человека убирает оператор по списку. */
  | { readonly outcome: "entry-closed" }
  /** Сопровождение действует на срок назначения, только если `support` есть в правах тарифа. */
  | { readonly outcome: "by-tier" }
  | { readonly outcome: "shown"; readonly shows: CabinetView }
  | { readonly outcome: "not-applicable"; readonly because: string };

export interface AccessTransitionScenario {
  /** Правило перехода словами модели. */
  readonly rule: string;
  /** Что открыто после перехода у затронутого основания. */
  readonly after: Readonly<Partial<Record<AccessSurface, AccessExpectation>>>;
}

export interface AccessPublicationRule {
  readonly rule: string;
  /** Код проблемы, которым сервер отклоняет публикацию. */
  readonly rejectedWith: string;
}

/** Форма, которую читает контроль полноты: он не доверяет типу и проверяет каждое имя. */
export interface AccessScenarioTable {
  readonly cells: Readonly<Record<string, Readonly<Record<string, AccessExpectation>>>>;
  readonly transitions: Readonly<Record<string, AccessTransitionScenario>>;
  readonly publications: Readonly<Record<string, AccessPublicationRule>>;
}

type ByGround = Readonly<Record<AccessGround, AccessExpectation>>;

const open = (term: AccessTerm): AccessExpectation => ({ outcome: "open", term });
const shown = (shows: CabinetView): AccessExpectation => ({ outcome: "shown", shows });
const locked: AccessExpectation = { outcome: "locked" };
const closed: AccessExpectation = { outcome: "closed" };
const entryClosed: AccessExpectation = { outcome: "entry-closed" };
const byTier: AccessExpectation = { outcome: "by-tier" };
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
    "direct": expectation,
    "expired-or-revoked": expectation,
    "multiple-grounds": expectation,
    "withdrawal-refund": expectation,
    "moderation": expectation,
  };
}

/**
 * Материал и артефакты продукта X. Прямое право в сценарии — `guide:X` без даты окончания и
 * отдельное `support` со сроком. Модерационный запрет стоит поверх разовой покупки и материалы не
 * закрывает.
 */
const productContent: ByGround = {
  "guest": locked,
  "account-without-rights": locked,
  "one-time-purchase": open("lifetime"),
  "tier-via-course": open("lifetime"),
  "tier-via-tribute": open("ground-term"),
  "manual-assignment": open("ground-term"),
  "hidden-active-tier": open("ground-term"),
  "direct": open("lifetime"),
  "expired-or-revoked": locked,
  "multiple-grounds": open("lifetime"),
  "withdrawal-refund": locked,
  "moderation": open("lifetime"),
};

const withoutAccount = "Без входа нет Account, у которого это можно проверить";

export const accessScenarioTable = {
  cells: {
    // Публичный материал открыт всем, какое бы основание ни было.
    "public-material": everyGround(open("public")),
    // Закрытый материал живёт внутри продукта; без права виден только тизер.
    "product-material": productContent,
    // Программа и описание продукта видны всем, пока продукт не в архиве.
    "programme": everyGround(open("public")),
    // У закрытого артефакта без права видно описание, файл отдаётся только по праву.
    "artifacts": productContent,
    // Видео закрытого материала не имеет тизера: без права ссылка воспроизведения не выдаётся.
    "video": { ...productContent, "guest": closed, "account-without-rights": closed, "expired-or-revoked": closed, "withdrawal-refund": closed },
    // Общую группу открывает право на продукт, сопровождение и тариф с `community`. Запрет в чате
    // сопровождение не отзывает. Когда право кончилось, закрыт только
    // новый вход: автоматических удалений нет, убирает оператор по списку. Запрет модератора закрывает чат.
    "community-chat": {
      ...productContent,
      "guest": closed,
      "account-without-rights": closed,
      "expired-or-revoked": entryClosed,
      "withdrawal-refund": entryClosed,
      "moderation": closed,
    },
    // Сопровождение из предложения продукта — шесть месяцев с покупки; у тарифа — по его правам.
    "support": {
      "guest": closed,
      "account-without-rights": closed,
      "one-time-purchase": open("six-months"),
      "tier-via-course": byTier,
      "tier-via-tribute": byTier,
      "manual-assignment": byTier,
      "hidden-active-tier": byTier,
      "direct": open("ground-term"),
      "expired-or-revoked": closed,
      "multiple-grounds": open("six-months"),
      "withdrawal-refund": closed,
      "moderation": open("six-months"),
    },
    // Кабинет: пусто, действующее основание, все основания, завершённые, покупка в истории, запрет.
    "cabinet": {
      "guest": notApplicable(withoutAccount),
      "account-without-rights": shown("nothing"),
      "one-time-purchase": shown("active"),
      "tier-via-course": shown("active"),
      "tier-via-tribute": shown("active"),
      "manual-assignment": shown("active"),
      "hidden-active-tier": shown("active"),
      "direct": shown("active"),
      "expired-or-revoked": shown("ended"),
      "multiple-grounds": shown("all-grounds"),
      "withdrawal-refund": shown("purchase-history"),
      "moderation": shown("restriction"),
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
      rule: "На границе срока перестаёт действовать только это основание; новый вход в чат закрыт.",
      after: { "product-material": locked, "video": closed, "community-chat": entryClosed },
    },
    "revocation": {
      rule: "Владелец отозвал назначение: доступ закрывается сразу, уже выданная ссылка на видео отклоняется.",
      after: { "product-material": locked, "video": closed, "community-chat": entryClosed },
    },
    "bridge-replaced-by-tribute": {
      rule: "Временный источник Tribute мост не выключает; подтверждённый период выключает его, дальше действует назначение по Tribute.",
      // Сопровождение моста прекращается: остаётся только то, что даёт тариф назначения по Tribute.
      after: { "product-material": open("ground-term"), "support": byTier },
    },
    "tribute-temporary-source-lost": {
      rule: "Подтверждённый выход из прежней группы завершает временный источник: права назначения не действуют, новый вход в чат закрыт.",
      after: { "product-material": locked, "video": closed, "community-chat": entryClosed },
    },
    "refund": {
      rule: "Отказ от договора разовой покупки прекращает право на продукт и сопровождение; новый вход в чат закрыт.",
      after: { "product-material": locked, "support": closed, "community-chat": entryClosed },
    },
    "refund-without-withdrawal": {
      rule: "Компенсация без отказа от договора доступ не меняет: право на продукт, сопровождение и общая группа сохраняются.",
      after: { "product-material": open("lifetime"), "support": open("six-months"), "community-chat": open("lifetime") },
    },
    "support-kept-by-other-ground": {
      rule: "Сопровождение — одно общее право: отказ от одной покупки не прекращает сопровождение другого действующего основания, и общая группа остаётся открытой на его срок.",
      after: { "product-material": locked, "support": open("ground-term"), "community-chat": open("ground-term") },
    },
    "material-added-to-product": {
      rule: "Новый материал продукта открывается всем, кому продукт открыт: покупке, составу назначения и прямому праву.",
      after: { "product-material": open("lifetime") },
    },
    "material-removed-from-product": {
      rule: "Материал уходит из купленного продукта только подтверждённым снятием с записью; после снятия право на продукт его не открывает.",
      after: { "product-material": locked },
    },
    "guide-archived": {
      // Скрыть программу архивного продукта от тех, кому он не открыт, и снимать его с продажи при
      // архиве — отдельная задача после релиза (сноска 4 модели); здесь проверяется сохранность у имеющих право.
      rule: "Архивный продукт уходит с витрины; те, кому он открыт, сохраняют программу, материалы и артефакты.",
      after: { "programme": open("public"), "product-material": open("lifetime"), "artifacts": open("lifetime") },
    },
    "tier-composition-change": {
      rule: "Новая редакция состава тарифа не меняет действующие назначения, пока владелец явно не расширит их. Стартовый тариф и подписка состава не правят: они открывают все продукты, включая новые.",
      after: { "product-material": open("ground-term") },
    },
    "tier-archived-with-assignments": {
      rule: "Архив тарифа снимает его с продажи и назначения навсегда, а действующие назначения сохраняют доступ.",
      after: { "product-material": open("ground-term") },
    },
  } satisfies Record<AccessTransition, AccessTransitionScenario>,
  publications: {
    "standalone-membership-publication-rejected": {
      rule: "Закрытый материал вне продуктов не публикуется: закрытое живёт внутри продуктов, публичное открыто всем.",
      rejectedWith: "membership_outside_product",
    },
  } satisfies Record<AccessPublicationScenario, AccessPublicationRule>,
} as const satisfies AccessScenarioTable;
