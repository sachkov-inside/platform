import { describe, expect, it } from "vitest";

import {
  readAiModelsReferenceFile,
  type AiModelsReference,
} from "../../src/modules/ai-models/ai-models-reference-file.js";
import {
  aiModelsEstimateUsd,
  aiModelsMultiple,
  aiModelsPower,
  aiModelsPriceLevel,
  aiModelsUsd,
} from "../../src/modules/ai-models/widget/ai-models-widget-display.js";
import {
  formatAiModelsWidgetRequest,
  parseAiModelsWidgetRequest,
  type AiModelsWidgetRequest,
} from "../../src/modules/ai-models/widget/ai-models-widget-request.js";
import {
  aiModelsChatData,
  aiModelsRequests,
  aiModelsResponse,
} from "../../src/modules/ai-models/widget/ai-models-widget-wire.js";
import { syntheticAiModelsReference } from "../support/synthetic-ai-models-reference.js";

/** The synthetic Справочник as the import accepts it. */
function reference(
  change: (file: ReturnType<typeof syntheticAiModelsReference>) => void = () =>
    undefined,
): AiModelsReference {
  const file = syntheticAiModelsReference();
  change(file);
  const result = readAiModelsReferenceFile(file);
  if (result.status !== "valid") throw new Error(JSON.stringify(result.errors));
  return result.reference;
}

const NBSP = "\u00a0";

/** The model codes of a list page, with its group titles in place. */
function listedCodes(data: ReturnType<typeof aiModelsResponse>) {
  if (data?.[0] !== "l") throw new Error("The answer is not a list page");
  return data[5].map((row) =>
    typeof row === "string" ? row.split("|")[0] : row,
  );
}

describe("Мощность and price level", () => {
  it.each([
    [1, 5],
    [10, 5],
    [11, 4],
    [20, 4],
    [21, 3],
    [30, 3],
    [31, 2],
    [40, 2],
    [41, 1],
    [120, 1],
  ])("gives Arena rank %i a Мощность of %i dots", (rank, dots) => {
    expect(aiModelsPower(rank)).toBe(dots);
  });

  it.each([
    [7.43, 5],
    [5, 5],
    [4.99, 4],
    [2, 4],
    [1.99, 3],
    [1, 3],
    [0.99, 2],
    [0.3, 2],
    [0.29, 1],
    [0.01, 1],
  ])("gives a task of $%f a price level of %i", (taskUsd, level) => {
    expect(aiModelsPriceLevel(taskUsd)).toBe(level);
  });
});

describe("money and multiples", () => {
  it.each([
    [20, "$20"],
    [19.99, "$19,99"],
    [6.1, "$6,10"],
    [0.3, "$0,30"],
    [1000, `$1${NBSP}000`],
    [1234.5, `$1${NBSP}234,50`],
  ])("writes a price of %f as %s", (usd, text) => {
    expect(aiModelsUsd(usd)).toBe(text);
  });

  it.each([
    [45, "$45"],
    [99.4, "$99"],
    [99.6, "$100"],
    [154.9, "$150"],
    [667, "$670"],
    [999, `$1${NBSP}000`],
    [3517, `$3${NBSP}500`],
    [7033, `$7${NBSP}000`],
    [12_345, `$12${NBSP}300`],
  ])(
    "rounds an estimate of %f to %s: whole dollars, tens below $1 000, hundreds above",
    (usd, text) => {
      expect(aiModelsEstimateUsd(usd)).toBe(text);
    },
  );

  it.each([
    [33.35, "33 раза"],
    [35.17, "35 раз"],
    [21.05, "21 раз"],
    [22, "22 раза"],
    [12, "12 раз"],
    [13.8, "14 раз"],
    [102, "102 раза"],
    [112, "112 раз"],
    [10, "10 раз"],
    [9.95, "10 раз"],
    [3, "3 раза"],
    [5, "5 раз"],
    [1.5, "1,5 раза"],
    [4.46, "4,5 раза"],
    [1.06, "1,1 раза"],
  ])("writes a multiple of %f as «в %s больше цены»", (ratio, text) => {
    expect(aiModelsMultiple(ratio)).toBe(text);
  });

  it.each([1.04, 1, 0.5])(
    "writes no multiple of %f: the estimate is not above the price",
    (ratio) => {
      expect(aiModelsMultiple(ratio)).toBe("");
    },
  );
});

describe("widget requests", () => {
  it.each<[string, AiModelsWidgetRequest]>([
    ["3lp0", { kind: "list", filter: "p", page: 0 }],
    ["3lf0", { kind: "list", filter: "f", page: 0 }],
    ["3lv12", { kind: "list", filter: "v", page: 12 }],
    ["3lc1", { kind: "list", filter: "c", page: 1 }],
    ["3lp-1", { kind: "list", filter: "p", page: -1 }],
    ["3matlas-pro", { kind: "card", model: "atlas-pro" }],
    ["3sdelta", { kind: "subscriptions", model: "delta" }],
    ["3a", { kind: "about" }],
  ])("reads %s and writes it back", (data, request) => {
    expect(parseAiModelsWidgetRequest(data)).toEqual(request);
    expect(formatAiModelsWidgetRequest(request)).toBe(data);
  });

  it.each([
    "lp0",
    "3",
    "3lx0",
    "3lp",
    "3lp123",
    "3lp-2",
    "3lp-0",
    "3m",
    "3mAtlas",
    "3a1",
    "2h",
    `3m${"a".repeat(17)}`,
  ])("refuses %s", (data) => {
    expect(parseAiModelsWidgetRequest(data)).toBeUndefined();
  });

  it("lists every request the widget can send for a Справочник", () => {
    const codes = [
      "atlas-pro",
      "boreal-2",
      "atlas-mini",
      "gale",
      "cirrus-7",
      "delta",
      "echo",
      "fjord",
      "halo",
    ];
    expect(
      aiModelsRequests(reference()).map(formatAiModelsWidgetRequest),
    ).toEqual([
      "3lp0",
      "3lp1",
      "3lf0",
      "3lv0",
      "3lc0",
      "3lc1",
      ...codes.map((code) => `3m${code}`),
      ...codes.map((code) => `3s${code}`),
      "3a",
    ]);
  });
});

describe("list of models", () => {
  it("shows «Мощные» by Arena rank, seven models a page, leaders and author badges", () => {
    const data = reference();

    expect(
      aiModelsResponse(data, { kind: "list", filter: "p", page: 0 }),
    ).toEqual([
      "l",
      "p",
      0,
      2,
      "12.11",
      [
        "atlas-pro|Atlas 3 Pro|5|1|wb|||самая сильная в примере, но дорогая",
        "boreal-2|Boreal 2|5|1|fc|||сильная и недорогая",
        "atlas-mini|Atlas 3 Mini|5|0|fb|||почти как Pro, но дешевле",
        "gale|Gale 4|5|0||||неплохая и дешёвая",
        "cirrus-7|Cirrus 7|4|0|fp|||средняя по силе, есть в подписке от $6",
        "delta|Delta 1|3|0|fm|||очень дешёвая, для простых задач",
        "echo|Echo 5 Flash|2|0||||дешёвая, только по API",
      ],
    ]);
    expect(
      aiModelsResponse(data, { kind: "list", filter: "p", page: 1 }),
    ).toEqual([
      "l",
      "p",
      1,
      2,
      "12.11",
      [
        "fjord|Fjord 2 Max|1|0||||слабее и дороже соседей",
        "halo|Halo 1 Lite|1|0||||дешёвая, но слабее остальных",
      ],
    ]);
  });

  // Arrows of messages sent before 12.11.2026 still fire on Telegram clients that ignore
  // `disabled`, asking for one page past either end.
  it.each([
    [2, 1],
    [9, 1],
    [-1, 0],
  ])(
    "answers a page %i past the ends with the nearest page %i",
    (asked, shown) => {
      const data = reference();

      expect(
        aiModelsResponse(data, { kind: "list", filter: "p", page: asked }),
      ).toEqual(
        aiModelsResponse(data, { kind: "list", filter: "p", page: shown }),
      );
    },
  );

  it("sends the first page of «Мощные» as the chat state of a new message", () => {
    const data = reference();

    expect(aiModelsChatData(data)).toEqual(
      aiModelsResponse(data, { kind: "list", filter: "p", page: 0 }),
    );
  });

  it("groups «Мой выбор» in the author's order, repeats a model of two groups and drops the favorite badge", () => {
    expect(
      aiModelsResponse(reference(), { kind: "list", filter: "f", page: 0 }),
    ).toEqual([
      "l",
      "f",
      0,
      1,
      "12.11",
      [
        ["g", "На каждый день"],
        "boreal-2|Boreal 2|5|1|c|||сильная и недорогая",
        "atlas-mini|Atlas 3 Mini|5|0|b|||почти как Pro, но дешевле",
        "delta|Delta 1|3|0|m|||очень дешёвая, для простых задач",
        ["g", "Дизайн и моушн"],
        "atlas-mini|Atlas 3 Mini|5|0|b|||почти как Pro, но дешевле",
        "cirrus-7|Cirrus 7|4|0|p|||средняя по силе, есть в подписке от $6",
      ],
    ]);
  });

  it("repeats the group title at the top of a page that continues the group", () => {
    const data = reference((file) => {
      for (const code of ["gale", "echo", "fjord", "halo", "atlas-pro"])
        Object.assign(file.author.models, {
          [code]: {
            badges: [
              { badge: "favorite", text: "в группе", groups: ["daily"] },
            ],
          },
        });
    });

    const first = aiModelsResponse(data, {
      kind: "list",
      filter: "f",
      page: 0,
    });
    const second = aiModelsResponse(data, {
      kind: "list",
      filter: "f",
      page: 1,
    });

    expect(first?.[3]).toBe(2);
    expect(listedCodes(first)).toEqual([
      ["g", "На каждый день"],
      "atlas-pro",
      "boreal-2",
      "atlas-mini",
      "gale",
      "delta",
      "echo",
      "fjord",
    ]);
    expect(listedCodes(second)).toEqual([
      ["g", "На каждый день"],
      "halo",
      ["g", "Дизайн и моушн"],
      "atlas-mini",
      "cirrus-7",
    ]);
  });

  it("keeps in «Цена/качество» only models without a stronger and cheaper one, by task price", () => {
    expect(
      aiModelsResponse(reference(), { kind: "list", filter: "v", page: 0 }),
    ).toEqual([
      "l",
      "v",
      0,
      1,
      "12.11",
      [
        "delta|Delta 1|3|0|fm|$0,12||очень дешёвая, для простых задач",
        "gale|Gale 4|5|0||$0,75||неплохая и дешёвая",
        "boreal-2|Boreal 2|5|1|fc|$1,30||сильная и недорогая",
        "atlas-pro|Atlas 3 Pro|5|1|wb|$6,20||самая сильная в примере, но дорогая",
      ],
    ]);
  });

  it("shows «Дёшево» by task price with the cheapest plan without a promo, or none for API only", () => {
    const data = reference();

    expect(
      aiModelsResponse(data, { kind: "list", filter: "c", page: 0 }),
    ).toEqual([
      "l",
      "c",
      0,
      2,
      "12.11",
      [
        "delta|Delta 1|3|0|fm|$0,12|$10|очень дешёвая, для простых задач",
        "halo|Halo 1 Lite|1|0||$0,20|$10|дешёвая, но слабее остальных",
        "echo|Echo 5 Flash|2|0||$0,31||дешёвая, только по API",
        "gale|Gale 4|5|0||$0,75|$19,99|неплохая и дешёвая",
        "cirrus-7|Cirrus 7|4|0|fp|$0,90|$6|средняя по силе, есть в подписке от $6",
        "boreal-2|Boreal 2|5|1|fc|$1,30|$10|сильная и недорогая",
        "atlas-mini|Atlas 3 Mini|5|0|fb|$2,40|$20|почти как Pro, но дешевле",
      ],
    ]);
    expect(
      aiModelsResponse(data, { kind: "list", filter: "c", page: 1 }),
    ).toEqual([
      "l",
      "c",
      1,
      2,
      "12.11",
      [
        "fjord|Fjord 2 Max|1|0||$3,10|$6|слабее и дороже соседей",
        // Its Lite plan is a promo, so the cheapest plan to rely on is Max.
        "atlas-pro|Atlas 3 Pro|5|1|wb|$6,20|$100|самая сильная в примере, но дорогая",
      ],
    ]);
  });
});

describe("model card", () => {
  it("shows the tab «Главное» with facts, the author's opinion and the Лучший агент", () => {
    expect(
      aiModelsResponse(reference(), { kind: "card", model: "atlas-pro" }),
    ).toEqual([
      "m",
      "atlas-pro",
      "Atlas 3 Pro",
      5,
      1,
      5,
      "$5 / $25 за 1 млн токенов · задача ≈ $6,20",
      "самая сильная в примере, но дорогая",
      [
        ["w", "тратит много токенов на одну задачу"],
        ["bh", "Atlas часто блокирует аккаунты"],
      ],
      [],
      ["код", "агенты"],
      [
        "m",
        "Atlas Code",
        "1-е место в синтетическом замере",
        "OpenCode по ключу API",
      ],
      "В Atlas Lite модель доступна только до 30.11",
    ]);
  });

  it("puts badges in a fixed order, the advice last, and names the models of «Лучше взять»", () => {
    const data = reference((file) => {
      file.author.models.delta.badges.reverse();
      Object.assign(file.author.models.delta, {
        betterPick: { models: ["gale", "boreal-2"], reason: "сильнее" },
      });
    });

    expect(aiModelsResponse(data, { kind: "card", model: "delta" })).toEqual([
      "m",
      "delta",
      "Delta 1",
      3,
      0,
      1,
      "$0,30 / $1,20 за 1 млн токенов · задача ≈ $0,12",
      "очень дешёвая, для простых задач",
      [
        ["f", "дешёвая модель на каждый день"],
        ["m", "для средних задач"],
        ["", "советую Multigate Go"],
      ],
      ["сильнее", "gale", "Gale 4", "boreal-2", "Boreal 2"],
      ["дёшево и много", "код"],
      [
        "m",
        "Delta Harness",
        "лучший синтетический замер",
        "Работает почти в любом агенте",
      ],
      "",
    ]);
  });

  it("shows a model without the author's opinion and with a Лучший агент the company recommends", () => {
    expect(
      aiModelsResponse(reference(), { kind: "card", model: "echo" }),
    ).toEqual([
      "m",
      "echo",
      "Echo 5 Flash",
      2,
      0,
      2,
      "$0,50 / $2 за 1 млн токенов · задача ≈ $0,31",
      "дешёвая, только по API",
      [],
      [],
      ["дёшево и много", "тексты"],
      ["v", "Echo CLI", "компания советует его первым", "OpenCode"],
      "",
    ]);
  });

  it("answers nothing for a model the Справочник does not have", () => {
    expect(
      aiModelsResponse(reference(), { kind: "card", model: "nobody" }),
    ).toBeUndefined();
    expect(
      aiModelsResponse(reference(), { kind: "subscriptions", model: "nobody" }),
    ).toBeUndefined();
  });
});

describe("subscriptions of a model", () => {
  it("groups plans by service with the ban risk, the Russian marks, estimates and vendor wording", () => {
    expect(
      aiModelsResponse(reference(), {
        kind: "subscriptions",
        model: "atlas-pro",
      }),
    ).toEqual([
      "s",
      "atlas-pro",
      "Atlas 3 Pro",
      5,
      1,
      5,
      [
        [
          "Atlas Chat",
          "h",
          "nn",
          [
            "Lite · $20|v|||только по акции до 30.11||1",
            "Max · $100|v|||в 5 раз больше Lite||",
            `Ultra · $200|m|≈${NBSP}$4${NBSP}200|21 раз||на Pro половина лимита|`,
          ],
        ],
      ],
    ]);
  });

  it("folds neighbouring plans of one service with the same vendor wording into one row", () => {
    expect(
      aiModelsResponse(reference(), {
        kind: "subscriptions",
        model: "atlas-mini",
      }),
    ).toEqual([
      "s",
      "atlas-mini",
      "Atlas 3 Mini",
      5,
      0,
      4,
      [
        [
          "Atlas Chat",
          "h",
          "nn",
          [
            `Lite · $20|m|≈${NBSP}$670|33 раза|||`,
            "Max–Ultra · от $100|v|||в 5 раз больше Lite||",
          ],
        ],
      ],
    ]);
  });

  it("shows a vendor dollar limit without «≈», a plan priced «от» and a note", () => {
    expect(
      aiModelsResponse(reference(), {
        kind: "subscriptions",
        model: "cirrus-7",
      }),
    ).toEqual([
      "s",
      "cirrus-7",
      "Cirrus 7",
      4,
      0,
      2,
      [
        [
          "Cirrus Cloud",
          "",
          "yy",
          ["Starter–Pro · от $6|v|||20–200 тыс. кредитов в месяц||"],
        ],
        ["Multigate", "", "uu", ["Go · $10|o|$15|1,5 раза||скидка до 30.11|"]],
      ],
    ]);
  });

  it("orders services by their first plan in the model's list", () => {
    const data = reference((file) => {
      const boreal = file.models[1];
      if (boreal) boreal.subscriptions.reverse();
    });

    expect(
      aiModelsResponse(data, { kind: "subscriptions", model: "boreal-2" }),
    ).toEqual([
      "s",
      "boreal-2",
      "Boreal 2",
      5,
      1,
      3,
      [
        [
          "Multigate",
          "",
          "uu",
          ["Go Plus · $40|o|$120|3 раза|||", "Go · $10|o|$30|3 раза|||"],
        ],
        ["Boreal", "", "yn", ["Team–Pro · от $19,99|v|||лимит без чисел||"]],
      ],
    ]);
  });

  it("does not fold plans whose notes or promo marks differ", () => {
    const data = reference((file) => {
      const mini = file.models[2];
      Object.assign(mini?.subscriptions[2] ?? {}, { note: "до 30.11" });
    });

    expect(
      aiModelsResponse(data, {
        kind: "subscriptions",
        model: "atlas-mini",
      })?.[6],
    ).toEqual([
      [
        "Atlas Chat",
        "h",
        "nn",
        [
          `Lite · $20|m|≈${NBSP}$670|33 раза|||`,
          "Max · $100|v|||в 5 раз больше Lite||",
          "Ultra · $200|v|||в 5 раз больше Lite|до 30.11|",
        ],
      ],
    ]);
  });

  it("shows no service for a model sold only through the API", () => {
    expect(
      aiModelsResponse(reference(), { kind: "subscriptions", model: "echo" }),
    ).toEqual(["s", "echo", "Echo 5 Flash", 2, 0, 2, []]);
  });
});

describe("about the data", () => {
  it("shows the full check date and the lines of «О данных»", () => {
    expect(aiModelsResponse(reference(), { kind: "about" })).toEqual([
      "a",
      "12.11.2026",
      [
        "Мощность и цена задачи: синтетический рейтинг агентов",
        "Мощность: место в таблице агентов, каждая точка на 10 мест",
        "Замеры подписок: синтетический замер",
        "Значки, «Мой выбор» и «Лучше взять»: мнение автора",
      ],
    ]);
  });
});
