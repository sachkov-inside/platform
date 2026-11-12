import { z } from "zod";

import {
  TELEGRAM_WIDGET_DATA_MAX_BYTES,
  TELEGRAM_WIDGET_REQUEST_MAX_BYTES,
} from "../outbound/telegram-widget-limits.js";
import {
  AI_MODELS_CODE_PATTERN,
  aiModelsRequests,
  aiModelsResponse,
  formatAiModelsWidgetRequest,
  utf8ByteLength,
  type AiModelsWidgetRequest,
} from "./widget/ai-models-widget-wire.js";

// The Справочник file is the contract between the owner's research and this bot.
// docs/integrations/ai-models-reference-v1.md describes it for the owner; the JSON Schema beside
// that document is generated from the schema below (`pnpm ai-models:reference:schema`).

const code = z
  .string()
  .regex(new RegExp(`^${AI_MODELS_CODE_PATTERN}$`))
  .describe("Код: строчные латинские буквы, цифры и дефис, до 16 знаков.");
const text = z.string().min(1);
const usd = z.number().positive();
const russia = z
  .enum(["yes", "no", "unknown"])
  .describe("yes: да, no: нет, unknown: нет данных.");

const serviceSchema = z.strictObject({
  code: code.describe(
    "Постоянный код сервиса. По нему на сервис ссылаются тарифы.",
  ),
  name: text.describe("Название сервиса, как его видит человек."),
  fromRussia: russia.describe("Работает ли сервис из России."),
  russianCard: russia.describe("Принимает ли сервис российскую карту."),
});

const planSchema = z.strictObject({
  code: code.describe(
    "Постоянный код тарифа. По нему на тариф ссылаются подписки моделей.",
  ),
  service: z.string().describe("Код сервиса из списка services."),
  name: text.describe("Название тарифа без названия сервиса, например Pro."),
  usdPerMonth: usd.describe(
    "Цена в долларах в месяц, не больше двух знаков после точки.",
  ),
  priceFrom: z
    .boolean()
    .describe(
      "true: цена показывается как «от $X», у тарифа несколько уровней.",
    ),
});

const estimateSchema = z.strictObject({
  basis: z
    .enum(["measured", "vendor-dollar-limit"])
    .describe(
      "measured: независимый замер не меньше 5 аккаунтов. vendor-dollar-limit: компания сама называет лимит в долларах.",
    ),
  apiUsdPerMonth: usd.describe(
    "Сколько стоил бы тот же объём работы по ценам API, в долларах в месяц.",
  ),
  accounts: z
    .number()
    .int()
    .optional()
    .describe("Сколько аккаунтов замерено. Только для measured, не меньше 5."),
});

const subscriptionSchema = z.strictObject({
  plan: z.string().describe("Код тарифа из списка plans."),
  estimate: estimateSchema
    .optional()
    .describe("Оценка подписки. Ровно одно из estimate и vendorWording."),
  vendorWording: text
    .optional()
    .describe("Слова компании о лимите, когда оценки нет."),
  promo: z
    .boolean()
    .optional()
    .describe("true: модель есть в тарифе только по акции."),
  note: text.optional().describe("Короткое пояснение к строке тарифа."),
});

const tag = z.enum(["code", "texts", "research", "agents", "cheap-bulk"]);

const modelSchema = z.strictObject({
  code: code.describe(
    "Постоянный код модели. Виджет просит карточку модели по нему.",
  ),
  name: text.describe("Название модели, как его видит человек."),
  family: text.describe("Семейство модели, например Claude."),
  arenaRank: z
    .number()
    .int()
    .min(1)
    .describe("Место в таблице агентов Arena. У каждой модели своё."),
  taskUsd: usd.describe("Цена одной задачи по API в долларах, по Arena."),
  apiUsdPerMillionTokens: z.strictObject({
    input: usd.describe("Цена миллиона токенов на вход, в долларах."),
    output: usd.describe("Цена миллиона токенов на выход, в долларах."),
  }),
  tags: z
    .array(tag)
    .min(1)
    .max(5)
    .describe(
      "Метки задач: code код, texts тексты, research поиск и анализ, agents агенты, cheap-bulk дёшево и много.",
    ),
  summary: text.describe(
    "Сводка модели: для чего она хороша и чем за это платишь.",
  ),
  agent: z.strictObject({
    name: text.describe("Название Лучшего агента."),
    basis: z
      .enum(["measured", "vendor"])
      .describe("measured: выбран по замерам. vendor: его советует компания."),
    reason: text.describe("Короткая причина выбора."),
  }),
  alternatives: text.describe("Хорошие альтернативные агенты одной строкой."),
  subscriptions: z
    .array(subscriptionSchema)
    .max(12)
    .describe("Подписки сервисов с этой моделью, в порядке показа."),
  notice: text
    .optional()
    .describe("Объявленное изменение цены или конец акции, с датой."),
});

const badge = z.enum([
  "favorite",
  "confident",
  "mid-tasks",
  "pricey",
  "wasteful",
]);

const authorSchema = z
  .strictObject({
    favoriteGroups: z
      .array(
        z.strictObject({
          code: code.describe("Постоянный код группы «Мой выбор»."),
          title: text.describe("Название группы, как его видит человек."),
        }),
      )
      .describe("Группы фильтра «Мой выбор» в порядке показа."),
    services: z
      .record(
        code,
        z.strictObject({
          banRisk: z
            .enum(["high", "medium", "low"])
            .describe("Уровень значка «Риск бана»: высокий, средний, низкий."),
          text: text.describe("Пояснение автора к риску."),
          models: z
            .array(z.string())
            .describe("Коды моделей, которые получают значок «Риск бана»."),
        }),
      )
      .describe("Риск бана по кодам сервисов."),
    models: z
      .record(
        code,
        z.strictObject({
          badges: z
            .array(
              z.strictObject({
                badge: badge.describe(
                  "favorite «⭐ Мой выбор», confident «Уверенная», mid-tasks «Для средних задач», pricey «Дорого», wasteful «Невыгодно».",
                ),
                text: text.describe("Пояснение автора к значку."),
                groups: z
                  .array(z.string())
                  .optional()
                  .describe(
                    "Коды групп из favoriteGroups. Только у favorite, и у него обязательно.",
                  ),
              }),
            )
            .optional(),
          advice: text.optional().describe("Совет автора текстом."),
          betterPick: z
            .strictObject({
              models: z
                .array(z.string())
                .min(1)
                .max(2)
                .describe("Коды одной или двух других моделей."),
              reason: text.describe("Почему лучше взять их."),
            })
            .optional()
            .describe(
              "«Лучше взять»: модели, которые автор советует вместо этой.",
            ),
        }),
      )
      .describe("Мнение автора по кодам моделей."),
  })
  .describe(
    "Мнение автора. Бот хранит его отдельно от фактов: будущая Ежедневная проверка меняет только факты.",
  );

export const aiModelsReferenceFileSchema = z.strictObject({
  format: z.literal("inside.ai-models-reference.v1"),
  checkedOn: z.iso
    .date()
    .describe("Дата проверки фактов. Человек видит «Проверено ДД.ММ»."),
  about: z
    .array(text)
    .min(1)
    .max(6)
    .describe("Строки экрана «О данных»: источники и как читать оценки."),
  services: z.array(serviceSchema),
  plans: z.array(planSchema),
  models: z
    .array(modelSchema)
    .min(1)
    .max(20)
    .describe("Модели. Порядок не важен: бот сортирует их сам."),
  author: authorSchema,
});

export type AiModelsReference = z.infer<typeof aiModelsReferenceFileSchema>;
export type AiModelsPlan = AiModelsReference["plans"][number];
export type AiModelsModel = AiModelsReference["models"][number];
export type AiModelsSubscription = AiModelsModel["subscriptions"][number];

/**
 * One reason the file is rejected. It names the place by codes and never repeats the file's
 * texts. A code that is itself broken is replaced by `№<position in its list>`.
 */
export interface AiModelsReferenceError {
  readonly model?: string;
  readonly plan?: string;
  readonly service?: string;
  readonly group?: string;
  /** The widget request whose answer does not fit, mark included. */
  readonly request?: string;
  readonly field?: string;
  readonly reason: string;
}

export type AiModelsReferenceFileResult =
  | { readonly status: "valid"; readonly reference: AiModelsReference }
  | {
      readonly status: "rejected";
      readonly errors: readonly AiModelsReferenceError[];
    };

/** Checks the whole file. Texts of an accepted file are trimmed and composed (NFC). */
export function readAiModelsReferenceFile(
  input: unknown,
): AiModelsReferenceFileResult {
  const parsed = aiModelsReferenceFileSchema.safeParse(input, {
    error: z.locales.ru().localeError,
  });
  if (!parsed.success)
    return {
      status: "rejected",
      errors: parsed.error.issues.map((issue) => schemaError(input, issue)),
    };
  const reference = clean(parsed.data);
  const errors = [
    ...textErrors(reference),
    ...serviceErrors(reference),
    ...planErrors(reference),
    ...modelErrors(reference),
    ...groupErrors(reference),
    ...authorServiceErrors(reference),
    ...authorModelErrors(reference),
  ];
  // The answers are built only from a file whose codes and references hold.
  if (errors.length === 0) errors.push(...answerErrors(reference));
  return errors.length > 0
    ? { status: "rejected", errors }
    : { status: "valid", reference };
}

/**
 * Limits the file is checked against besides its shape. The published schema carries them, so
 * the owner's tools read the same numbers the import uses.
 */
export const AI_MODELS_REFERENCE_LIMITS = {
  aboutLineCharacters: 90,
  serviceNameCharacters: 24,
  planNameCharacters: 20,
  modelNameCharacters: 24,
  familyCharacters: 16,
  summaryCharacters: 50,
  agentNameCharacters: 24,
  agentReasonCharacters: 50,
  alternativesCharacters: 90,
  noticeCharacters: 50,
  vendorWordingCharacters: 50,
  noteCharacters: 30,
  favoriteGroupTitleCharacters: 20,
  banRiskTextCharacters: 60,
  badgeTextCharacters: 60,
  adviceCharacters: 60,
  betterPickReasonCharacters: 30,
  measuredAccountsMin: 5,
  widgetDataBytes: TELEGRAM_WIDGET_DATA_MAX_BYTES,
  widgetRequestBytes: TELEGRAM_WIDGET_REQUEST_MAX_BYTES,
} as const;
const LIMITS = AI_MODELS_REFERENCE_LIMITS;

/** Length in characters as the text limits count it: code points of the composed form. */
export const aiModelsTextLength = (value: string): number =>
  Array.from(value.normalize("NFC")).length;

type Place = Omit<AiModelsReferenceError, "reason">;
type Text = readonly [place: Place, value: string, limit: number];

/** Every text of the file with its place and its limit in characters. */
function texts(reference: AiModelsReference): Text[] {
  const { author } = reference;
  const optional = (place: Place, value: string | undefined, limit: number) =>
    value === undefined ? [] : [[place, value, limit] as const];
  return [
    ...reference.about.map((line, index): Text => [
      { field: `about.${String(index)}` },
      line,
      LIMITS.aboutLineCharacters,
    ]),
    ...reference.services.map(({ code, name }): Text => [
      { service: code, field: "name" },
      name,
      LIMITS.serviceNameCharacters,
    ]),
    ...reference.plans.map(({ code, name }): Text => [
      { plan: code, field: "name" },
      name,
      LIMITS.planNameCharacters,
    ]),
    ...reference.models.flatMap((model): Text[] => {
      const at = (field: string) => ({ model: model.code, field });
      return [
        [at("name"), model.name, LIMITS.modelNameCharacters],
        [at("family"), model.family, LIMITS.familyCharacters],
        [at("summary"), model.summary, LIMITS.summaryCharacters],
        [at("agent.name"), model.agent.name, LIMITS.agentNameCharacters],
        [at("agent.reason"), model.agent.reason, LIMITS.agentReasonCharacters],
        [at("alternatives"), model.alternatives, LIMITS.alternativesCharacters],
        ...model.subscriptions.flatMap((subscription, index) => [
          ...optional(
            at(`subscriptions.${String(index)}.vendorWording`),
            subscription.vendorWording,
            LIMITS.vendorWordingCharacters,
          ),
          ...optional(
            at(`subscriptions.${String(index)}.note`),
            subscription.note,
            LIMITS.noteCharacters,
          ),
        ]),
        ...optional(at("notice"), model.notice, LIMITS.noticeCharacters),
      ];
    }),
    ...author.favoriteGroups.map(({ code, title }): Text => [
      { group: code, field: "title" },
      title,
      LIMITS.favoriteGroupTitleCharacters,
    ]),
    ...Object.entries(author.services).map(([service, risk]): Text => [
      { service, field: "author.text" },
      risk.text,
      LIMITS.banRiskTextCharacters,
    ]),
    ...Object.entries(author.models).flatMap(([model, opinion]): Text[] => [
      ...(opinion.badges ?? []).map((badge, index): Text => [
        { model, field: `author.badges.${String(index)}.text` },
        badge.text,
        LIMITS.badgeTextCharacters,
      ]),
      ...optional(
        { model, field: "author.advice" },
        opinion.advice,
        LIMITS.adviceCharacters,
      ),
      ...optional(
        { model, field: "author.betterPick.reason" },
        opinion.betterPick?.reason,
        LIMITS.betterPickReasonCharacters,
      ),
    ]),
  ];
}

/** The widget splits the fields of a row by this sign, so no text may hold it. */
const ROW_SEPARATOR = "|";

function textErrors(reference: AiModelsReference): AiModelsReferenceError[] {
  return texts(reference).flatMap(([place, value, limit]) => {
    const length = aiModelsTextLength(value);
    if (length === 0) return [{ ...place, reason: "Текст пуст." }];
    if (value.includes(ROW_SEPARATOR))
      return [
        {
          ...place,
          reason: `Знак «${ROW_SEPARATOR}» не допускается: виджет разделяет им поля строки.`,
        },
      ];
    return length > limit
      ? [
          {
            ...place,
            reason: `Знаков ${String(length)}, лимит ${String(limit)}.`,
          },
        ]
      : [];
  });
}

const REPEATED_CODE = "Код повторяется в файле.";
const REPEATED_MODEL = "Модель повторяется.";
/** A code the file refers to; one that is not a code may be text and is not repeated. */
const shown = (value: string): string => (codeFormat.test(value) ? value : "…");

function repeatedCodes(
  entries: readonly { readonly code: string }[],
  place: (code: string) => Place,
): AiModelsReferenceError[] {
  const seen = new Set<string>();
  return entries.flatMap(({ code }) => {
    const repeated = seen.has(code);
    seen.add(code);
    return repeated ? [{ ...place(code), reason: REPEATED_CODE }] : [];
  });
}

function serviceErrors(reference: AiModelsReference): AiModelsReferenceError[] {
  return repeatedCodes(reference.services, (service) => ({
    service,
    field: "code",
  }));
}

function planErrors(reference: AiModelsReference): AiModelsReferenceError[] {
  const services = new Set(reference.services.map(({ code }) => code));
  return [
    ...repeatedCodes(reference.plans, (plan) => ({ plan, field: "code" })),
    ...reference.plans.flatMap(({ code, service, usdPerMonth }) => [
      ...(services.has(service)
        ? []
        : [
            {
              plan: code,
              field: "service",
              reason: `Сервиса «${shown(service)}» нет в списке services.`,
            },
          ]),
      ...(hasCents(usdPerMonth)
        ? []
        : [
            {
              plan: code,
              field: "usdPerMonth",
              reason: "Не больше двух знаков после точки.",
            },
          ]),
    ]),
  ];
}

/** True when the price has at most two digits after the point. */
const hasCents = (usd: number): boolean =>
  Math.abs(usd * 100 - Math.round(usd * 100)) < 1e-6;

function modelErrors(reference: AiModelsReference): AiModelsReferenceError[] {
  const plans = new Set(reference.plans.map(({ code }) => code));
  const ranks = new Map<number, string>();
  return [
    ...repeatedCodes(reference.models, (model) => ({ model, field: "code" })),
    ...reference.models.flatMap((model) => {
      const at = (field: string, reason: string) => ({
        model: model.code,
        field,
        reason,
      });
      const errors: AiModelsReferenceError[] = [];
      const holder = ranks.get(model.arenaRank);
      if (holder === undefined) ranks.set(model.arenaRank, model.code);
      else
        errors.push(
          at(
            "arenaRank",
            `Место ${String(model.arenaRank)} в Arena уже занято моделью «${holder}».`,
          ),
        );
      if (new Set(model.tags).size !== model.tags.length)
        errors.push(at("tags", "Метка задачи повторяется."));
      const subscribed = new Set<string>();
      model.subscriptions.forEach((subscription, index) => {
        const field = `subscriptions.${String(index)}`;
        if (!plans.has(subscription.plan))
          errors.push(
            at(
              `${field}.plan`,
              `Тарифа «${shown(subscription.plan)}» нет в списке plans.`,
            ),
          );
        else if (subscribed.has(subscription.plan))
          errors.push(
            at(`${field}.plan`, "Этот тариф уже есть в подписках модели."),
          );
        subscribed.add(subscription.plan);
        if (
          (subscription.estimate === undefined) ===
          (subscription.vendorWording === undefined)
        )
          errors.push(
            at(field, "Нужно ровно одно из полей estimate и vendorWording."),
          );
        const estimate = subscription.estimate;
        const accounts = `${field}.estimate.accounts`;
        if (estimate?.basis === "measured" && estimate.accounts === undefined)
          errors.push(
            at(
              accounts,
              `Оценке по замеру нужно число замеренных аккаунтов, не меньше ${String(LIMITS.measuredAccountsMin)}.`,
            ),
          );
        if (
          estimate?.basis === "measured" &&
          estimate.accounts !== undefined &&
          estimate.accounts < LIMITS.measuredAccountsMin
        )
          errors.push(
            at(
              accounts,
              `Оценка по замеру показывается при ${String(LIMITS.measuredAccountsMin)} и больше замеренных аккаунтах, в файле ${String(estimate.accounts)}.`,
            ),
          );
        if (
          estimate?.basis === "vendor-dollar-limit" &&
          estimate.accounts !== undefined
        )
          errors.push(
            at(accounts, "Число аккаунтов бывает только у оценки по замеру."),
          );
      });
      return errors;
    }),
  ];
}

/** Favorite groups: distinct codes, and each one named by at least one favorite badge. */
function groupErrors(reference: AiModelsReference): AiModelsReferenceError[] {
  const named = new Set(
    Object.values(reference.author.models).flatMap(({ badges }) =>
      (badges ?? []).flatMap(({ groups }) => groups ?? []),
    ),
  );
  return [
    ...repeatedCodes(reference.author.favoriteGroups, (group) => ({
      group,
      field: "code",
    })),
    ...reference.author.favoriteGroups
      .filter(({ code }) => !named.has(code))
      .map(({ code }) => ({
        group: code,
        field: "code",
        reason: "В группе нет моделей: ни один значок favorite её не называет.",
      })),
  ];
}

/** Each listed code refers to a model other than `self`; a model appears once. */
function modelListErrors(
  codes: readonly string[],
  models: ReadonlySet<string>,
  field: string,
  place: Place,
  self?: string,
): AiModelsReferenceError[] {
  const seen = new Set<string>();
  return codes.flatMap((code, index) => {
    const at = (reason: string) => [
      { ...place, field: `${field}.${String(index)}`, reason },
    ];
    if (code === self) return at("«Лучше взять» указывает на саму модель.");
    if (!models.has(code))
      return at(`Модели «${shown(code)}» нет в списке models.`);
    const repeated = seen.has(code);
    seen.add(code);
    return repeated ? at(REPEATED_MODEL) : [];
  });
}

function authorServiceErrors(
  reference: AiModelsReference,
): AiModelsReferenceError[] {
  const services = new Set(reference.services.map(({ code }) => code));
  const models = new Set(reference.models.map(({ code }) => code));
  return Object.entries(reference.author.services).flatMap(([service, risk]) =>
    services.has(service)
      ? modelListErrors(risk.models, models, "author.models", { service })
      : [
          {
            service,
            field: "author",
            reason: "Сервиса с этим кодом нет в списке services.",
          },
        ],
  );
}

function authorModelErrors(
  reference: AiModelsReference,
): AiModelsReferenceError[] {
  const models = new Set(reference.models.map(({ code }) => code));
  const groups = new Set(
    reference.author.favoriteGroups.map(({ code }) => code),
  );
  return Object.entries(reference.author.models).flatMap(([model, opinion]) => {
    if (!models.has(model))
      return [
        {
          model,
          field: "author",
          reason: "Модели с этим кодом нет в списке models.",
        },
      ];
    const at = (field: string, reason: string) => ({ model, field, reason });
    const errors: AiModelsReferenceError[] = [];
    const kinds = new Set<string>();
    (opinion.badges ?? []).forEach(({ badge, groups: named }, index) => {
      const field = `author.badges.${String(index)}`;
      if (kinds.has(badge))
        errors.push(at(`${field}.badge`, "Этот значок уже есть у модели."));
      kinds.add(badge);
      if (badge !== "favorite") {
        if (named !== undefined)
          errors.push(
            at(`${field}.groups`, "Группы бывают только у значка favorite."),
          );
        return;
      }
      if (named === undefined || named.length === 0) {
        errors.push(
          at(
            `${field}.groups`,
            "Значку favorite нужна хотя бы одна группа из favoriteGroups.",
          ),
        );
        return;
      }
      const seen = new Set<string>();
      named.forEach((group, position) => {
        const groupField = `${field}.groups.${String(position)}`;
        if (!groups.has(group))
          errors.push(
            at(groupField, `Группы «${shown(group)}» нет в favoriteGroups.`),
          );
        else if (seen.has(group))
          errors.push(at(groupField, "Группа повторяется."));
        seen.add(group);
      });
    });
    const pick = opinion.betterPick;
    return [
      ...errors,
      ...(pick === undefined
        ? []
        : modelListErrors(
            pick.models,
            models,
            "author.betterPick.models",
            { model },
            model,
          )),
    ];
  });
}

/** One answer the widget can get from this Справочник and its size. */
export interface AiModelsAnswerSize {
  /** The request, mark included. */
  readonly request: string;
  readonly bytes: number;
}

/** Every answer to every request the widget can send for the Справочник, with its size. */
export function aiModelsAnswerSizes(
  reference: AiModelsReference,
): AiModelsAnswerSize[] {
  return measuredAnswers(reference).map(({ text, bytes }) => ({
    request: text,
    bytes,
  }));
}

function measuredAnswers(reference: AiModelsReference) {
  return aiModelsRequests(reference).map((request) => {
    const answer = aiModelsResponse(reference, request);
    if (answer === undefined)
      throw new Error("Every request of the Справочник has an answer");
    return {
      request,
      text: formatAiModelsWidgetRequest(request),
      bytes: utf8ByteLength(JSON.stringify(answer)),
    };
  });
}

const FILTER_NAMES = {
  p: "Мощные",
  f: "Мой выбор",
  v: "Цена/качество",
  c: "Дёшево",
} as const;

/** Every answer fits Telegram's widget data, and every request fits its widget query. */
function answerErrors(reference: AiModelsReference): AiModelsReferenceError[] {
  return measuredAnswers(reference).flatMap(({ request, text, bytes }) => {
    const requestBytes = utf8ByteLength(text);
    if (requestBytes > LIMITS.widgetRequestBytes)
      return [
        {
          ...answerPlace(request),
          request: text,
          reason: `Запрос виджета: байт ${String(requestBytes)}, лимит ${String(LIMITS.widgetRequestBytes)}. Сократите код модели.`,
        },
      ];
    return bytes > LIMITS.widgetDataBytes
      ? [
          {
            ...answerPlace(request),
            request: text,
            reason: `${answerName(request)}: байт ${String(bytes)}, лимит ${String(LIMITS.widgetDataBytes)}. ${answerAdvice(request)}`,
          },
        ]
      : [];
  });
}

function answerPlace(request: AiModelsWidgetRequest): Place {
  switch (request.kind) {
    case "card":
    case "subscriptions":
      return { model: request.model };
    case "about":
      return { field: "about" };
    case "list":
      return {};
  }
}

function answerName(request: AiModelsWidgetRequest): string {
  switch (request.kind) {
    case "list":
      return `Страница ${String(request.page + 1)} фильтра «${FILTER_NAMES[request.filter]}»`;
    case "card":
      return "Вкладка «Главное»";
    case "subscriptions":
      return "Вкладка «Подписки»";
    case "about":
      return "Экран «О данных»";
  }
}

function answerAdvice(request: AiModelsWidgetRequest): string {
  switch (request.kind) {
    case "list":
      return "Сократите названия или сводки моделей этой страницы.";
    case "card":
      return "Сократите тексты модели или мнение автора о ней.";
    case "subscriptions":
      return "Сократите названия сервисов и тарифов, слова компаний или пояснения.";
    case "about":
      return "Сократите строки about.";
  }
}

const codeFormat = new RegExp(`^${AI_MODELS_CODE_PATTERN}$`);
const lists = {
  services: "service",
  plans: "plan",
  models: "model",
} as const;

function schemaError(
  input: unknown,
  issue: z.core.$ZodIssue,
): AiModelsReferenceError {
  const path = issue.path.map((part) =>
    typeof part === "symbol" ? String(part) : part,
  );
  const [list, index, ...rest] = path;
  const fieldOf = (parts: readonly (string | number)[], prefix = "") =>
    parts.length > 0 ? { field: prefix + parts.map(String).join(".") } : {};
  if (
    (list === "services" || list === "plans" || list === "models") &&
    typeof index === "number"
  )
    return {
      [lists[list]]: entryName(listOf(input, [list]), index),
      ...fieldOf(rest),
      reason: issue.message,
    };
  if (list === "author") {
    const [, section, key, ...inside] = path;
    if (section === "favoriteGroups" && typeof key === "number")
      return {
        group: entryName(listOf(input, ["author", "favoriteGroups"]), key),
        ...fieldOf(inside),
        reason: issue.message,
      };
    if (
      (section === "services" || section === "models") &&
      typeof key === "string"
    )
      return {
        [section === "services" ? "service" : "model"]: keyName(
          valueAt(input, ["author", section]),
          key,
        ),
        ...fieldOf(inside, "author."),
        reason: issue.message,
      };
  }
  return { ...fieldOf(path), reason: issue.message };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function valueAt(input: unknown, path: readonly string[]): unknown {
  let value = input;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  return value;
}

function listOf(input: unknown, path: readonly string[]): unknown[] {
  const value = valueAt(input, path);
  return Array.isArray(value) ? value : [];
}

/** The author's own code of a broken entry, when the file has a usable one. */
function entryName(entries: readonly unknown[], index: number): string {
  const entry = entries[index];
  const name = isRecord(entry) ? entry["code"] : undefined;
  return typeof name === "string" && codeFormat.test(name)
    ? name
    : `№${String(index + 1)}`;
}

/** A key of the author's section; a key that is not a code may be text, so only its place shows. */
function keyName(record: unknown, key: string): string {
  if (codeFormat.test(key)) return key;
  const keys = isRecord(record) ? Object.keys(record) : [];
  return `№${String(keys.indexOf(key) + 1)}`;
}

const tidy = (value: string): string => value.normalize("NFC").trim();
/** The tidied optional text under its key, or no key at all. */
function tidyOptional(
  key: string,
  value: string | undefined,
): Record<string, string> {
  return value === undefined ? {} : { [key]: tidy(value) };
}

function clean(reference: AiModelsReference): AiModelsReference {
  const { author } = reference;
  return {
    format: reference.format,
    checkedOn: reference.checkedOn,
    about: reference.about.map(tidy),
    services: reference.services.map((service) => ({
      ...service,
      name: tidy(service.name),
    })),
    plans: reference.plans.map((plan) => ({ ...plan, name: tidy(plan.name) })),
    models: reference.models.map(
      ({ notice, subscriptions, agent, ...model }) => ({
        ...model,
        name: tidy(model.name),
        family: tidy(model.family),
        summary: tidy(model.summary),
        agent: { ...agent, name: tidy(agent.name), reason: tidy(agent.reason) },
        alternatives: tidy(model.alternatives),
        subscriptions: subscriptions.map(
          ({ vendorWording, note, ...subscription }) => ({
            ...subscription,
            ...tidyOptional("vendorWording", vendorWording),
            ...tidyOptional("note", note),
          }),
        ),
        ...tidyOptional("notice", notice),
      }),
    ),
    author: {
      favoriteGroups: author.favoriteGroups.map((group) => ({
        ...group,
        title: tidy(group.title),
      })),
      services: Object.fromEntries(
        Object.entries(author.services).map(([service, risk]) => [
          service,
          { ...risk, text: tidy(risk.text) },
        ]),
      ),
      models: Object.fromEntries(
        Object.entries(author.models).map(
          ([model, { badges, advice, betterPick }]) => [
            model,
            {
              ...(badges === undefined
                ? {}
                : {
                    badges: badges.map((badge) => ({
                      ...badge,
                      text: tidy(badge.text),
                    })),
                  }),
              ...tidyOptional("advice", advice),
              ...(betterPick === undefined
                ? {}
                : {
                    betterPick: {
                      ...betterPick,
                      reason: tidy(betterPick.reason),
                    },
                  }),
            },
          ],
        ),
      ),
    },
  };
}
