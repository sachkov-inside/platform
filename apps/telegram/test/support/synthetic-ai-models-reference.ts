/**
 * A fresh synthetic Справочник on every call, so a test may change its copy. It has every kind
 * of fact and opinion the file allows: nine fictional models on two pages, both favorite groups
 * with a model in each, every badge, a ban risk, a better pick of two models, measured and
 * vendor dollar estimates, vendor wordings that fold into one row, a promo, a notice, a plan
 * priced «от» and a model without subscriptions.
 */
export function syntheticAiModelsReference() {
  return {
    format: "inside.ai-models-reference.v1",
    checkedOn: "2026-11-12",
    about: [
      "Мощность и цена задачи: синтетический рейтинг агентов",
      "Мощность: место в таблице агентов, каждая точка на 10 мест",
      "Замеры подписок: синтетический замер",
      "Значки, «Мой выбор» и «Лучше взять»: мнение автора",
    ],
    services: [
      {
        code: "atlas",
        name: "Atlas Chat",
        fromRussia: "no",
        russianCard: "no",
      },
      {
        code: "boreal",
        name: "Boreal",
        fromRussia: "yes",
        russianCard: "no",
      },
      {
        code: "gate",
        name: "Multigate",
        fromRussia: "unknown",
        russianCard: "unknown",
      },
      {
        code: "cirrus",
        name: "Cirrus Cloud",
        fromRussia: "yes",
        russianCard: "yes",
      },
    ],
    plans: [
      plan("atlas-lite", "atlas", "Lite", 20),
      plan("atlas-max", "atlas", "Max", 100),
      plan("atlas-ultra", "atlas", "Ultra", 200),
      plan("boreal-pro", "boreal", "Pro", 19.99),
      plan("boreal-team", "boreal", "Team", 49.99),
      plan("gate-go", "gate", "Go", 10),
      plan("gate-plus", "gate", "Go Plus", 40),
      plan("cirrus-pack", "cirrus", "Starter–Pro", 6, true),
    ],
    models: [
      {
        code: "atlas-pro",
        name: "Atlas 3 Pro",
        family: "Atlas",
        arenaRank: 1,
        taskUsd: 6.2,
        apiUsdPerMillionTokens: { input: 5, output: 25 },
        tags: ["code", "agents"],
        summary: "самая сильная в примере, но дорогая",
        agent: {
          name: "Atlas Code",
          basis: "measured",
          reason: "1-е место в синтетическом замере",
        },
        alternatives: "OpenCode по ключу API",
        subscriptions: [
          {
            plan: "atlas-lite",
            vendorWording: "только по акции до 30.11",
            promo: true,
          },
          { plan: "atlas-max", vendorWording: "в 5 раз больше Lite" },
          {
            plan: "atlas-ultra",
            estimate: { basis: "measured", apiUsdPerMonth: 4210, accounts: 12 },
            note: "на Pro половина лимита",
          },
        ],
        notice: "В Atlas Lite модель доступна только до 30.11",
      },
      {
        code: "boreal-2",
        name: "Boreal 2",
        family: "Boreal",
        arenaRank: 2,
        taskUsd: 1.3,
        apiUsdPerMillionTokens: { input: 2, output: 10 },
        tags: ["code", "research", "agents"],
        summary: "сильная и недорогая",
        agent: {
          name: "Boreal CLI",
          basis: "vendor",
          reason: "компания тестирует модель в нём",
        },
        alternatives: "Cline по ключу API",
        subscriptions: [
          { plan: "boreal-pro", vendorWording: "лимит без чисел" },
          { plan: "boreal-team", vendorWording: "лимит без чисел" },
          {
            plan: "gate-go",
            estimate: { basis: "vendor-dollar-limit", apiUsdPerMonth: 30 },
          },
          {
            plan: "gate-plus",
            estimate: { basis: "vendor-dollar-limit", apiUsdPerMonth: 120 },
          },
        ],
      },
      {
        code: "atlas-mini",
        name: "Atlas 3 Mini",
        family: "Atlas",
        arenaRank: 4,
        taskUsd: 2.4,
        apiUsdPerMillionTokens: { input: 2, output: 10 },
        tags: ["code", "texts"],
        summary: "почти как Pro, но дешевле",
        agent: {
          name: "Atlas Code",
          basis: "measured",
          reason: "2-е место в синтетическом замере",
        },
        alternatives: "OpenCode",
        subscriptions: [
          {
            plan: "atlas-lite",
            estimate: { basis: "measured", apiUsdPerMonth: 667, accounts: 40 },
          },
          { plan: "atlas-max", vendorWording: "в 5 раз больше Lite" },
          { plan: "atlas-ultra", vendorWording: "в 5 раз больше Lite" },
        ],
      },
      {
        code: "gale",
        name: "Gale 4",
        family: "Gale",
        arenaRank: 8,
        taskUsd: 0.75,
        apiUsdPerMillionTokens: { input: 1, output: 4 },
        tags: ["texts", "research"],
        summary: "неплохая и дешёвая",
        agent: {
          name: "Gale Studio",
          basis: "measured",
          reason: "лучший синтетический замер",
        },
        alternatives: "OpenCode",
        subscriptions: [
          { plan: "boreal-pro", vendorWording: "лимит без чисел" },
        ],
      },
      {
        code: "cirrus-7",
        name: "Cirrus 7",
        family: "Cirrus",
        arenaRank: 12,
        taskUsd: 0.9,
        apiUsdPerMillionTokens: { input: 1.4, output: 4.4 },
        tags: ["code"],
        summary: "средняя по силе, есть в подписке от $6",
        agent: {
          name: "Cirrus Code",
          basis: "measured",
          reason: "41,2% в синтетическом замере",
        },
        alternatives: "OpenCode, Cline",
        subscriptions: [
          {
            plan: "cirrus-pack",
            vendorWording: "20–200 тыс. кредитов в месяц",
          },
          {
            plan: "gate-go",
            estimate: { basis: "vendor-dollar-limit", apiUsdPerMonth: 15 },
            note: "скидка до 30.11",
          },
        ],
      },
      {
        code: "delta",
        name: "Delta 1",
        family: "Delta",
        arenaRank: 23,
        taskUsd: 0.12,
        apiUsdPerMillionTokens: { input: 0.3, output: 1.2 },
        tags: ["cheap-bulk", "code"],
        summary: "очень дешёвая, для простых задач",
        agent: {
          name: "Delta Harness",
          basis: "measured",
          reason: "лучший синтетический замер",
        },
        alternatives: "Работает почти в любом агенте",
        subscriptions: [
          {
            plan: "gate-go",
            estimate: { basis: "vendor-dollar-limit", apiUsdPerMonth: 100 },
          },
          {
            plan: "gate-plus",
            estimate: { basis: "vendor-dollar-limit", apiUsdPerMonth: 200 },
          },
        ],
      },
      {
        code: "echo",
        name: "Echo 5 Flash",
        family: "Echo",
        arenaRank: 35,
        taskUsd: 0.31,
        apiUsdPerMillionTokens: { input: 0.5, output: 2 },
        tags: ["cheap-bulk", "texts"],
        summary: "дешёвая, только по API",
        agent: {
          name: "Echo CLI",
          basis: "vendor",
          reason: "компания советует его первым",
        },
        alternatives: "OpenCode",
        subscriptions: [],
      },
      {
        code: "fjord",
        name: "Fjord 2 Max",
        family: "Fjord",
        arenaRank: 44,
        taskUsd: 3.1,
        apiUsdPerMillionTokens: { input: 3, output: 15 },
        tags: ["texts"],
        summary: "слабее и дороже соседей",
        agent: {
          name: "Fjord Code",
          basis: "vendor",
          reason: "замеров нет",
        },
        alternatives: "OpenCode",
        subscriptions: [
          {
            plan: "cirrus-pack",
            vendorWording: "20–200 тыс. кредитов в месяц",
          },
        ],
      },
      {
        code: "halo",
        name: "Halo 1 Lite",
        family: "Halo",
        arenaRank: 60,
        taskUsd: 0.2,
        apiUsdPerMillionTokens: { input: 0.3, output: 1.2 },
        tags: ["cheap-bulk"],
        summary: "дешёвая, но слабее остальных",
        agent: {
          name: "Halo Code",
          basis: "vendor",
          reason: "компания советует его первым",
        },
        alternatives: "OpenCode, Codex",
        subscriptions: [
          {
            plan: "gate-go",
            estimate: { basis: "vendor-dollar-limit", apiUsdPerMonth: 60 },
          },
        ],
      },
    ],
    author: {
      favoriteGroups: [
        { code: "daily", title: "На каждый день" },
        { code: "design", title: "Дизайн и моушн" },
      ],
      services: {
        atlas: {
          banRisk: "high",
          text: "Atlas часто блокирует аккаунты",
          models: ["atlas-pro", "atlas-mini"],
        },
      },
      models: {
        "atlas-pro": {
          badges: [
            { badge: "wasteful", text: "тратит много токенов на одну задачу" },
          ],
        },
        "atlas-mini": {
          badges: [
            {
              badge: "favorite",
              text: "на каждый день и для дизайна",
              groups: ["daily", "design"],
            },
          ],
        },
        "boreal-2": {
          badges: [
            {
              badge: "favorite",
              text: "сильная и недорогая",
              groups: ["daily"],
            },
            { badge: "confident", text: "доводит задачу до конца" },
          ],
        },
        delta: {
          badges: [
            {
              badge: "favorite",
              text: "дешёвая модель на каждый день",
              groups: ["daily"],
            },
            { badge: "mid-tasks", text: "справится, если вести по шагам" },
          ],
          advice: "советую Multigate Go",
        },
        "cirrus-7": {
          badges: [
            { badge: "favorite", text: "для дизайна", groups: ["design"] },
            { badge: "pricey", text: "подписка дорогая для своего объёма" },
          ],
          betterPick: { models: ["boreal-2"], reason: "сильнее и дешевле" },
        },
        fjord: {
          betterPick: {
            models: ["boreal-2", "delta"],
            reason: "они проверенные",
          },
        },
      },
    },
  };
}

export type SyntheticAiModelsReference = ReturnType<
  typeof syntheticAiModelsReference
>;

function plan(
  code: string,
  service: string,
  name: string,
  usdPerMonth: number,
  priceFrom = false,
) {
  return { code, service, name, usdPerMonth, priceFrom };
}
