import {
  TELEGRAM_WIDGET_DATA_MAX_BYTES,
  utf8ByteLength,
} from "../../outbound/telegram-widget-limits.js";
import type {
  AiModelsModel,
  AiModelsReference,
} from "../ai-models-reference-file.js";
import {
  aiModelsByRank,
  aiModelsByTaskPrice,
  aiModelsCheapestPlan,
  aiModelsEstimate,
  aiModelsFullDate,
  aiModelsMultiple,
  aiModelsPlanLines,
  aiModelsPower,
  aiModelsPriceLevel,
  aiModelsShortDate,
  aiModelsUsd,
  aiModelsValueModels,
  isAiModelsLeader,
  type AiModelsPlanLine,
} from "./ai-models-widget-display.js";
import {
  AI_MODELS_FILTERS,
  type AiModelsFilter,
  type AiModelsWidgetRequest,
} from "./ai-models-widget-request.js";

// The wire format between the bot and the ИИ-модели widget (widget.js draws it).
//
// Bot to widget: `chat_data` of sendWidget and `data` of answerWidgetQuery. Each is a JSON array
// whose first item names the screen, at most 1 024 bytes of UTF-8.
// Widget to bot: `widget_query.data`, the requests that ai-models-widget-request.ts reads.
// The widget's code and data are public.
//
// Who writes what. The bot computes every rule and formats every value: money with a comma and
// spaces in thousands, «≈», multiples with «раз» or «раза», dates, plan names with prices.
// ai-models-widget-display.ts owns the rules and the formats of money, multiples and dates; this
// file writes them into screens. Fixed sets travel as one-letter codes, and the widget holds
// their labels. The widget also holds the fixed words that would repeat on every row or every
// page and cost 30 to 300 bytes of each answer (spec #2034 lists them among the bot's texts):
// - «Цена/качество»: the header «По независимым замерам, без мнения автора» and the footer
//   «Мощность: рейтинг агентов Arena. Цена: одна задача по API. Здесь модели, которым нет замены
//   сильнее и дешевле одновременно.»;
// - «Дёшево»: «задача» after the price, «подписка от» before the plan price, «только API»;
// - a plan row: «в месяц по API» after the estimate, «в … больше цены» around the multiple and
//   the mark of a vendor dollar limit.
//
// A row of a list (a model in the list, a plan in «Подписки») is one string whose fields are
// separated by "|"; the import refuses a file with "|" in any text. A field never holds a "|",
// so `row.split("|")` always yields the documented number of fields.
//
// Codes:
// - badge: f «⭐ Мой выбор», c «Уверенная», m «Для средних задач», p «Дорого», w «Невыгодно»,
//   b «Риск бана». A list row writes them together in this order, for example "fb".
// - ban risk level: h высокий, m средний, l низкий.
// - Russia marks: two letters, from Russia then a Russian card; y да, n нет, u нет данных.
// - basis of the Лучший агент: m «по замерам», v «советует компания».
// - basis of a plan row: m an estimate by measurement (the estimate starts with «≈»), o a limit
//   the vendor states in dollars (spec #2034 marks it «лимит OpenCode»), v the vendor's words.
// - filter: p «Мощные», f «⭐ Мой выбор», v «Цена/качество», c «Дёшево».

const BADGE_CODES = {
  favorite: "f",
  confident: "c",
  "mid-tasks": "m",
  pricey: "p",
  wasteful: "w",
} as const;
/** A badge of the author's opinion. */
type BadgeCode = (typeof BADGE_CODES)[keyof typeof BADGE_CODES];
/** The badges in their order; "b" is «Риск бана», which the services' ban risks give. */
const BADGE_ORDER: readonly (BadgeCode | "b")[] = [
  "f",
  "c",
  "m",
  "p",
  "w",
  "b",
];
const RISK_CODES = { high: "h", medium: "m", low: "l" } as const;
type RiskCode = (typeof RISK_CODES)[keyof typeof RISK_CODES];
const RUSSIA_CODES = { yes: "y", no: "n", unknown: "u" } as const;
type RussiaCode = (typeof RUSSIA_CODES)[keyof typeof RUSSIA_CODES];
const TAG_WORDS = {
  code: "код",
  texts: "тексты",
  research: "поиск и анализ",
  agents: "агенты",
  "cheap-bulk": "дёшево и много",
} as const;
/** Models on a page of the list; group titles do not count. */
const PAGE_MODELS = 7;

type Flag = 0 | 1;

/**
 * A model in a list: `code|name|power|leader|badges|price|plan|summary`.
 * - `power` "1" to "5" dots of Мощность; `leader` "1" for the first two places of Arena, else "0";
 * - `badges` the badge codes, without f in the filter f;
 * - `price` the task price ("$0,14") in the filters v and c, else empty; the widget writes
 *   «задача» after it in c;
 * - `plan` in the filter c only: the price of the cheapest plan without a promo ("$6"), and the
 *   widget writes «подписка от $6»; empty in c means «только API»; empty in the other filters;
 * - `summary` the Сводка модели. A tap on the row asks for `m<code>`.
 */
export type AiModelsListRow = string;
/** The title of a «Мой выбор» group; it precedes its models and repeats on a page it continues. */
export type AiModelsGroupRow = readonly [kind: "g", title: string];

/**
 * A page of the list. `page` counts from 0, `pages` is at least 1, `checked` is the check date
 * «ДД.ММ» the widget shows as «Проверено ДД.ММ». A page holds up to seven models; group titles do
 * not count. The widget asks for another page with `l<filter><page>`.
 */
export type AiModelsListData = readonly [
  screen: "l",
  filter: AiModelsFilter,
  page: number,
  pages: number,
  checked: string,
  rows: readonly (AiModelsListRow | AiModelsGroupRow)[],
];

/**
 * A line of «Мнение автора»: a badge code and the author's text. Ban risk carries its level,
 * "bh", "bm" or "bl"; the advice has no badge, "". Badges come in the badge order, the advice last.
 */
export type AiModelsOpinionLine = readonly [
  badge: BadgeCode | `b${RiskCode}` | "",
  text: string,
];

/** The head shared by both tabs of a card. `priceLevel` 1 to 5 by the task price. */
type CardHead = readonly [
  code: string,
  name: string,
  /** 1 to 5 dots of Мощность. */
  power: number,
  /** 1 for the first two places of Arena: the last dot is coloured. */
  leader: Flag,
  priceLevel: number,
];

/**
 * Tab «Главное». `api` is a ready line ("$4 / $20 за 1 млн токенов · задача ≈ $5,47").
 * `betterPick` is empty or the reason followed by one or two models, each as a code and a name;
 * a tap on a model asks for `m<code>`. `tags` are ready words of the Метки задач. `agent` holds
 * the basis code, the name, the reason and the alternatives. `notice` is empty when there is none.
 */
export type AiModelsCardData = readonly [
  screen: "m",
  ...head: CardHead,
  api: string,
  summary: string,
  opinion: readonly AiModelsOpinionLine[],
  betterPick:
    | readonly []
    | readonly [reason: string, code: string, name: string]
    | readonly [
        reason: string,
        code: string,
        name: string,
        code: string,
        name: string,
      ],
  tags: readonly string[],
  agent: readonly [
    basis: "m" | "v",
    name: string,
    reason: string,
    alternatives: string,
  ],
  notice: string,
];

/**
 * A plan in «Подписки»: `label|basis|estimate|multiple|wording|note|promo`.
 * - `label` the plan name with its price ("Pro · $20"); neighbouring plans of one service with
 *   the same vendor wording fold into one row ("Plus–Ultra · от $19");
 * - `basis` m, o or v (see the codes above);
 * - `estimate` "≈ $670" for m, "$100" for o, empty for v; the widget writes «в месяц по API»;
 * - `multiple` "33 раза": the widget writes «в 33 раза больше цены»; empty for v and when the
 *   estimate is not above the price;
 * - `wording` the vendor's words for v, else empty; `note` the file's note or empty;
 * - `promo` "1" when the model is in the plan only by a promo, else empty. The widget draws no
 *   mark for it: as in the prototype, the vendor's words or the note name the promo.
 */
export type AiModelsPlanRow = string;
/** A service with the model's plans in the model's order. `banRisk` is empty without a risk. */
export type AiModelsServiceGroup = readonly [
  name: string,
  banRisk: "" | RiskCode,
  russia: `${RussiaCode}${RussiaCode}`,
  plans: readonly AiModelsPlanRow[],
];
/** Tab «Подписки». No groups: the model is sold only through the API. */
export type AiModelsSubscriptionsData = readonly [
  screen: "s",
  ...head: CardHead,
  services: readonly AiModelsServiceGroup[],
];

/** «О данных»: the full check date «ДД.ММ.ГГГГ» and the file's lines. */
export type AiModelsAboutData = readonly [
  screen: "a",
  checked: string,
  lines: readonly string[],
];

/**
 * The bot refused, or the widget sent something it cannot read. The widget shows the text, or
 * its own when there is none, with a button that repeats the request.
 */
export type AiModelsFailureData =
  readonly [screen: "x"] | readonly [screen: "x", text: string];

export type AiModelsScreenData =
  | AiModelsListData
  | AiModelsCardData
  | AiModelsSubscriptionsData
  | AiModelsAboutData;

export type AiModelsWidgetData = AiModelsScreenData | AiModelsFailureData;

export function encodeAiModelsWidgetData(data: AiModelsWidgetData): string {
  const text = JSON.stringify(data);
  const bytes = utf8ByteLength(text);
  if (bytes > TELEGRAM_WIDGET_DATA_MAX_BYTES)
    throw new RangeError(
      `ИИ-модели widget data "${data[0]}" takes ${String(bytes)} bytes; Telegram accepts ${String(TELEGRAM_WIDGET_DATA_MAX_BYTES)}.`,
    );
  return text;
}

/** Every request the widget can send for this Справочник: every page, card tab and «О данных». */
export function aiModelsRequests(
  reference: AiModelsReference,
): AiModelsWidgetRequest[] {
  const models = aiModelsByRank(reference.models);
  return [
    ...AI_MODELS_FILTERS.flatMap((filter) =>
      Array.from(
        { length: listPages(reference, filter).length },
        (_, page): AiModelsWidgetRequest => ({ kind: "list", filter, page }),
      ),
    ),
    ...models.map(({ code }): AiModelsWidgetRequest => ({
      kind: "card",
      model: code,
    })),
    ...models.map(({ code }): AiModelsWidgetRequest => ({
      kind: "subscriptions",
      model: code,
    })),
    { kind: "about" },
  ];
}

/** The answer to a request; `undefined` when the Справочник has no such page or model. */
export function aiModelsResponse(
  reference: AiModelsReference,
  request: AiModelsWidgetRequest,
): AiModelsScreenData | undefined {
  switch (request.kind) {
    case "list":
      return listData(reference, request.filter, request.page);
    case "card": {
      const model = findModel(reference, request.model);
      return model && cardData(reference, model);
    }
    case "subscriptions": {
      const model = findModel(reference, request.model);
      return model && subscriptionsData(reference, model);
    }
    case "about":
      return ["a", aiModelsFullDate(reference.checkedOn), reference.about];
  }
}

/** `chat_data` of a new widget message: the first page of «Мощные». */
export function aiModelsChatData(
  reference: AiModelsReference,
): AiModelsListData {
  const data = listData(reference, "p", 0);
  if (!data) throw new Error("A Справочник has at least one model");
  return data;
}

// Screens -------------------------------------------------------------------------------------

const findModel = (reference: AiModelsReference, code: string) =>
  reference.models.find((model) => model.code === code);

/**
 * The entry of the author's section under a code of the file. Only the file's own keys count: a
 * service or a model coded `constructor` without an entry gets nothing, not the built-in property.
 */
function own<Entry>(
  section: Readonly<Record<string, Entry>>,
  code: string,
): Entry | undefined {
  return Object.hasOwn(section, code) ? section[code] : undefined;
}

const leader = (model: AiModelsModel): Flag =>
  isAiModelsLeader(model) ? 1 : 0;

/** Services whose ban risk the author gives to the model, in the order of the file's services. */
function banRisks(reference: AiModelsReference, model: AiModelsModel) {
  return reference.services.flatMap(({ code }) => {
    const risk = own(reference.author.services, code);
    return risk?.models.includes(model.code) === true ? [risk] : [];
  });
}

/** Badge codes of a list row, in the badge order. */
function badgeCodes(
  reference: AiModelsReference,
  model: AiModelsModel,
): (BadgeCode | "b")[] {
  const codes = new Set<BadgeCode | "b">(
    (own(reference.author.models, model.code)?.badges ?? []).map(
      ({ badge }) => BADGE_CODES[badge],
    ),
  );
  if (banRisks(reference, model).length > 0) codes.add("b");
  return BADGE_ORDER.filter((code) => codes.has(code));
}

/** A model row and the group it is shown in, for the filter «Мой выбор». */
interface Listed {
  readonly model: AiModelsModel;
  readonly group?: string;
}

function listed(
  reference: AiModelsReference,
  filter: AiModelsFilter,
): Listed[] {
  switch (filter) {
    case "p":
      return aiModelsByRank(reference.models).map((model) => ({ model }));
    case "v":
      return aiModelsValueModels(reference).map((model) => ({ model }));
    case "c":
      return aiModelsByTaskPrice(reference.models).map((model) => ({ model }));
    case "f":
      return reference.author.favoriteGroups.flatMap(({ code, title }) =>
        aiModelsByRank(reference.models)
          .filter((model) =>
            (own(reference.author.models, model.code)?.badges ?? []).some(
              ({ badge, groups }) =>
                badge === "favorite" && groups?.includes(code) === true,
            ),
          )
          .map((model) => ({ model, group: title })),
      );
  }
}

/** Seven models a page; a filter without models still has one empty page. */
function listPages(
  reference: AiModelsReference,
  filter: AiModelsFilter,
): Listed[][] {
  const all = listed(reference, filter);
  const pages: Listed[][] = [];
  for (let start = 0; start < all.length; start += PAGE_MODELS)
    pages.push(all.slice(start, start + PAGE_MODELS));
  return pages.length > 0 ? pages : [[]];
}

function listData(
  reference: AiModelsReference,
  filter: AiModelsFilter,
  page: number,
): AiModelsListData | undefined {
  const pages = listPages(reference, filter);
  const models = pages[page];
  if (models === undefined) return undefined;
  const rows: (AiModelsListRow | AiModelsGroupRow)[] = [];
  let group: string | undefined;
  for (const { model, group: title } of models) {
    if (title !== undefined && title !== group) rows.push(["g", title]);
    group = title;
    rows.push(listRow(reference, model, filter));
  }
  return [
    "l",
    filter,
    page,
    pages.length,
    aiModelsShortDate(reference.checkedOn),
    rows,
  ];
}

function listRow(
  reference: AiModelsReference,
  model: AiModelsModel,
  filter: AiModelsFilter,
): AiModelsListRow {
  const badges = badgeCodes(reference, model).filter(
    (code) => !(filter === "f" && code === "f"),
  );
  const price =
    filter === "v" || filter === "c" ? aiModelsUsd(model.taskUsd) : "";
  const cheapest =
    filter === "c" ? aiModelsCheapestPlan(reference, model) : undefined;
  return [
    model.code,
    model.name,
    String(aiModelsPower(model.arenaRank)),
    String(leader(model)),
    badges.join(""),
    price,
    cheapest === undefined ? "" : aiModelsUsd(cheapest),
    model.summary,
  ].join("|");
}

function cardHead(model: AiModelsModel): CardHead {
  return [
    model.code,
    model.name,
    aiModelsPower(model.arenaRank),
    leader(model),
    aiModelsPriceLevel(model.taskUsd),
  ];
}

function cardData(
  reference: AiModelsReference,
  model: AiModelsModel,
): AiModelsCardData {
  const opinion = own(reference.author.models, model.code);
  const badges = (opinion?.badges ?? [])
    .map(({ badge, text }) => [BADGE_CODES[badge], text] as const)
    .sort(([a], [b]) => BADGE_ORDER.indexOf(a) - BADGE_ORDER.indexOf(b));
  const bans = banRisks(reference, model).map(
    ({ banRisk, text }): AiModelsOpinionLine => [
      `b${RISK_CODES[banRisk]}`,
      text,
    ],
  );
  const advice: AiModelsOpinionLine[] =
    opinion?.advice === undefined ? [] : [["", opinion.advice]];
  const { input, output } = model.apiUsdPerMillionTokens;
  return [
    "m",
    ...cardHead(model),
    `${aiModelsUsd(input)} / ${aiModelsUsd(output)} за 1 млн токенов · задача ≈ ${aiModelsUsd(model.taskUsd)}`,
    model.summary,
    [...badges, ...bans, ...advice],
    betterPick(reference, model),
    model.tags.map((tag) => TAG_WORDS[tag]),
    [
      model.agent.basis === "measured" ? "m" : "v",
      model.agent.name,
      model.agent.reason,
      model.alternatives,
    ],
    model.notice ?? "",
  ];
}

function betterPick(
  reference: AiModelsReference,
  model: AiModelsModel,
): AiModelsCardData[9] {
  const pick = own(reference.author.models, model.code)?.betterPick;
  if (pick === undefined) return [];
  const [first, second] = pick.models.map((code) => {
    const picked = findModel(reference, code);
    return [code, picked?.name ?? code] as const;
  });
  if (first === undefined) return [];
  return second === undefined
    ? [pick.reason, ...first]
    : [pick.reason, ...first, ...second];
}

function subscriptionsData(
  reference: AiModelsReference,
  model: AiModelsModel,
): AiModelsSubscriptionsData {
  return [
    "s",
    ...cardHead(model),
    [...aiModelsPlanLines(reference, model)].flatMap(
      ([code, lines]): AiModelsServiceGroup[] => {
        const service = reference.services.find((found) => found.code === code);
        if (service === undefined) return [];
        const risk = own(reference.author.services, code);
        return [
          [
            service.name,
            risk === undefined ? "" : RISK_CODES[risk.banRisk],
            `${RUSSIA_CODES[service.fromRussia]}${RUSSIA_CODES[service.russianCard]}`,
            lines.map(planRow),
          ],
        ];
      },
    ),
  ];
}

function planRow({ plans, subscription }: AiModelsPlanLine): AiModelsPlanRow {
  const [first] = plans;
  const last = plans.at(-1);
  if (first === undefined || last === undefined)
    throw new Error("A plan row covers at least one plan");
  const folded = plans.length > 1;
  const price = Math.min(...plans.map(({ usdPerMonth }) => usdPerMonth));
  const name = folded ? `${first.name}–${last.name}` : first.name;
  const from = folded || first.priceFrom ? "от " : "";
  const label = `${name} · ${from}${aiModelsUsd(price)}`;
  const { estimate } = subscription;
  return [
    label,
    estimate === undefined ? "v" : estimate.basis === "measured" ? "m" : "o",
    estimate === undefined ? "" : aiModelsEstimate(estimate),
    estimate === undefined
      ? ""
      : aiModelsMultiple(estimate.apiUsdPerMonth / first.usdPerMonth),
    subscription.vendorWording ?? "",
    subscription.note ?? "",
    subscription.promo === true ? "1" : "",
  ].join("|");
}
