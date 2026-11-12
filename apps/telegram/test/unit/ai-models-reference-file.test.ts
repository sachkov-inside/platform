import { describe, expect, it } from "vitest";

import {
  readAiModelsReferenceFile,
  type AiModelsReferenceError,
} from "../../src/modules/ai-models/ai-models-reference-file.js";
import { aiModelsResponse } from "../../src/modules/ai-models/widget/ai-models-widget-wire.js";
import { syntheticAiModelsReference } from "../support/synthetic-ai-models-reference.js";

/** The errors of a file the check must reject. */
function rejection(input: unknown): readonly AiModelsReferenceError[] {
  const result = readAiModelsReferenceFile(input);
  if (result.status !== "rejected") throw new Error("The file was accepted");
  return result.errors;
}

/** Where each error points, without its reason. */
const places = (errors: readonly AiModelsReferenceError[]) =>
  errors.map(({ reason: _reason, ...place }) => place);

describe("Справочник file", () => {
  it("accepts a correct file and keeps every fact and opinion", () => {
    const file = syntheticAiModelsReference();

    const result = readAiModelsReferenceFile(file);

    expect(result).toEqual({ status: "valid", reference: file });
  });
});

describe("Справочник file texts", () => {
  it("trims every text and stores it in composed form", () => {
    const file = syntheticAiModelsReference();
    const model = file.models[0];
    if (!model) throw new Error("The synthetic file has models");
    // «й» written as «и» and a combining breve.
    model.summary = "  сильная и дорогая, но мощнеи\u0306шая \n";
    file.about[0] = " Источник ";

    const result = readAiModelsReferenceFile(file);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.reference.models[0]?.summary).toBe(
      "сильная и дорогая, но мощнейшая",
    );
    expect(result.reference.about[0]).toBe("Источник");
  });
});

describe("Справочник file shape", () => {
  it("names the model by its code and the field of a schema violation", () => {
    const file = syntheticAiModelsReference();
    Object.assign(file.models[1] ?? {}, { arenaRank: 2.5 });

    expect(places(rejection(file))).toEqual([
      { model: "boreal-2", field: "arenaRank" },
    ]);
  });

  it("names a plan, a service and a favorite group by their codes", () => {
    const file = syntheticAiModelsReference();
    Object.assign(file.plans[2] ?? {}, { usdPerMonth: -1 });
    Object.assign(file.services[1] ?? {}, { fromRussia: "maybe" });
    Object.assign(file.author.favoriteGroups[1] ?? {}, { title: 5 });

    const result = readAiModelsReferenceFile(file);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errors.map(({ reason: _reason, ...place }) => place)).toEqual(
      [
        { service: "boreal", field: "fromRussia" },
        { plan: "atlas-ultra", field: "usdPerMonth" },
        { group: "design", field: "title" },
      ],
    );
  });

  it("names the model of the author's opinion and the service of a ban risk", () => {
    const file = syntheticAiModelsReference();
    Object.assign(file.author.models.delta, { advice: 7 });
    Object.assign(file.author.services.atlas, { banRisk: "extreme" });

    const result = readAiModelsReferenceFile(file);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errors.map(({ reason: _reason, ...place }) => place)).toEqual(
      [
        { service: "atlas", field: "author.banRisk" },
        { model: "delta", field: "author.advice" },
      ],
    );
  });

  it("names an entry by its position when its code is broken, and never repeats the file's texts", () => {
    const file = syntheticAiModelsReference();
    Object.assign(file.models[2] ?? {}, {
      code: "Секретная модель",
      summary: 42,
    });

    const result = readAiModelsReferenceFile(file);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.errors.map(({ model, field }) => [model, field])).toEqual([
      ["№3", "code"],
      ["№3", "summary"],
    ]);
    expect(JSON.stringify(result)).not.toContain("Секретная");
  });

  it("rejects an unknown field so that a typo does not pass unnoticed", () => {
    const file = syntheticAiModelsReference();
    Object.assign(file.models[0] ?? {}, { sumary: "опечатка" });

    const errors = rejection(file);

    expect(places(errors)).toEqual([{ model: "atlas-pro" }]);
    expect(errors[0]?.reason).toContain("sumary");
    expect(JSON.stringify(errors)).not.toContain("опечатка");
  });
});

type File = ReturnType<typeof syntheticAiModelsReference>;
const model = (file: File, index: number) => {
  const found = file.models[index];
  if (!found) throw new Error(`The synthetic file has model ${String(index)}`);
  return found;
};

describe("Справочник file references", () => {
  it.each<[string, (file: File) => void, object]>([
    [
      "a repeated model code",
      (file) => {
        model(file, 3).code = "delta";
      },
      { model: "delta", field: "code", reason: "Код повторяется в файле." },
    ],
    [
      "a repeated plan code",
      (file) => {
        const [first] = file.plans;
        if (first) file.plans.push({ ...first, name: "Lite 2" });
      },
      { plan: "atlas-lite", field: "code", reason: "Код повторяется в файле." },
    ],
    [
      "a repeated service code",
      (file) => {
        const gate = file.services[2];
        if (gate) file.services.push({ ...gate });
      },
      { service: "gate", field: "code", reason: "Код повторяется в файле." },
    ],
    [
      "a repeated favorite group code",
      (file) => {
        file.author.favoriteGroups.push({ code: "daily", title: "Ещё раз" });
      },
      { group: "daily", field: "code", reason: "Код повторяется в файле." },
    ],
    [
      "a repeated Arena rank",
      (file) => {
        model(file, 3).arenaRank = 4;
      },
      {
        model: "gale",
        field: "arenaRank",
        reason: "Место 4 в Arena уже занято моделью «atlas-mini».",
      },
    ],
    [
      "a plan of an unknown service",
      (file) => {
        Object.assign(file.plans[0] ?? {}, { service: "nobody" });
      },
      {
        plan: "atlas-lite",
        field: "service",
        reason: "Сервиса «nobody» нет в списке services.",
      },
    ],
    [
      "a subscription to an unknown plan, whose code is text",
      (file) => {
        Object.assign(model(file, 0).subscriptions[1] ?? {}, {
          plan: "Тайный тариф",
        });
      },
      {
        model: "atlas-pro",
        field: "subscriptions.1.plan",
        reason: "Тарифа «…» нет в списке plans.",
      },
    ],
    [
      "the same plan twice in one model",
      (file) => {
        Object.assign(model(file, 0).subscriptions[1] ?? {}, {
          plan: "atlas-lite",
        });
      },
      {
        model: "atlas-pro",
        field: "subscriptions.1.plan",
        reason: "Этот тариф уже есть в подписках модели.",
      },
    ],
    [
      "a subscription with both an estimate and vendor wording",
      (file) => {
        Object.assign(model(file, 0).subscriptions[2] ?? {}, {
          vendorWording: "лимит без чисел",
        });
      },
      {
        model: "atlas-pro",
        field: "subscriptions.2",
        reason: "Нужно ровно одно из полей estimate и vendorWording.",
      },
    ],
    [
      "a subscription with neither an estimate nor vendor wording",
      (file) => {
        Reflect.deleteProperty(
          model(file, 0).subscriptions[1] ?? {},
          "vendorWording",
        );
      },
      {
        model: "atlas-pro",
        field: "subscriptions.1",
        reason: "Нужно ровно одно из полей estimate и vendorWording.",
      },
    ],
    [
      "a measured estimate of four accounts",
      (file) => {
        Object.assign(model(file, 0).subscriptions[2] ?? {}, {
          estimate: { basis: "measured", apiUsdPerMonth: 900, accounts: 4 },
        });
      },
      {
        model: "atlas-pro",
        field: "subscriptions.2.estimate.accounts",
        reason:
          "Оценка по замеру показывается при 5 и больше замеренных аккаунтах, в файле 4.",
      },
    ],
    [
      "a measured estimate without accounts",
      (file) => {
        Object.assign(model(file, 0).subscriptions[2] ?? {}, {
          estimate: { basis: "measured", apiUsdPerMonth: 900 },
        });
      },
      {
        model: "atlas-pro",
        field: "subscriptions.2.estimate.accounts",
        reason:
          "Оценке по замеру нужно число замеренных аккаунтов, не меньше 5.",
      },
    ],
    [
      "accounts of a vendor dollar limit",
      (file) => {
        Object.assign(model(file, 1).subscriptions[2] ?? {}, {
          estimate: {
            basis: "vendor-dollar-limit",
            apiUsdPerMonth: 30,
            accounts: 10,
          },
        });
      },
      {
        model: "boreal-2",
        field: "subscriptions.2.estimate.accounts",
        reason: "Число аккаунтов бывает только у оценки по замеру.",
      },
    ],
    [
      "a repeated task tag",
      (file) => {
        model(file, 0).tags = ["code", "agents", "code"];
      },
      {
        model: "atlas-pro",
        field: "tags",
        reason: "Метка задачи повторяется.",
      },
    ],
    [
      "a plan price with three decimals",
      (file) => {
        Object.assign(file.plans[3] ?? {}, { usdPerMonth: 19.995 });
      },
      {
        plan: "boreal-pro",
        field: "usdPerMonth",
        reason: "Не больше двух знаков после точки.",
      },
    ],
  ])("rejects %s", (_name, change, error) => {
    const file = syntheticAiModelsReference();
    change(file);

    expect(readAiModelsReferenceFile(file)).toEqual({
      status: "rejected",
      errors: [error],
    });
  });
});

describe("Справочник file opinion of the author", () => {
  it.each<[string, (file: File) => void, object]>([
    [
      "a ban risk of an unknown service",
      (file) => {
        Object.assign(file.author.services, {
          nobody: { banRisk: "low", text: "Пояснение", models: [] },
        });
      },
      {
        service: "nobody",
        field: "author",
        reason: "Сервиса с этим кодом нет в списке services.",
      },
    ],
    [
      "a ban risk badge for an unknown model",
      (file) => {
        file.author.services.atlas.models.push("nobody");
      },
      {
        service: "atlas",
        field: "author.models.2",
        reason: "Модели «nobody» нет в списке models.",
      },
    ],
    [
      "a model listed twice under one ban risk",
      (file) => {
        file.author.services.atlas.models.push("atlas-pro");
      },
      {
        service: "atlas",
        field: "author.models.2",
        reason: "Модель повторяется.",
      },
    ],
    [
      "an opinion about an unknown model",
      (file) => {
        Object.assign(file.author.models, { nobody: { advice: "Совет" } });
      },
      {
        model: "nobody",
        field: "author",
        reason: "Модели с этим кодом нет в списке models.",
      },
    ],
    [
      "the same badge twice",
      (file) => {
        file.author.models["atlas-pro"].badges.push({
          badge: "wasteful",
          text: "ещё раз",
        });
      },
      {
        model: "atlas-pro",
        field: "author.badges.1.badge",
        reason: "Этот значок уже есть у модели.",
      },
    ],
    [
      "a favorite badge without groups",
      (file) => {
        Reflect.deleteProperty(
          file.author.models["atlas-mini"].badges[0] ?? {},
          "groups",
        );
      },
      {
        model: "atlas-mini",
        field: "author.badges.0.groups",
        reason: "Значку favorite нужна хотя бы одна группа из favoriteGroups.",
      },
    ],
    [
      "a favorite badge with an empty list of groups",
      (file) => {
        Object.assign(file.author.models["atlas-mini"].badges[0] ?? {}, {
          groups: [],
        });
      },
      {
        model: "atlas-mini",
        field: "author.badges.0.groups",
        reason: "Значку favorite нужна хотя бы одна группа из favoriteGroups.",
      },
    ],
    [
      "groups on a badge other than favorite",
      (file) => {
        Object.assign(file.author.models["boreal-2"].badges[1] ?? {}, {
          groups: ["daily"],
        });
      },
      {
        model: "boreal-2",
        field: "author.badges.1.groups",
        reason: "Группы бывают только у значка favorite.",
      },
    ],
    [
      "an unknown favorite group",
      (file) => {
        Object.assign(file.author.models["boreal-2"].badges[0] ?? {}, {
          groups: ["weekend"],
        });
      },
      {
        model: "boreal-2",
        field: "author.badges.0.groups.0",
        reason: "Группы «weekend» нет в favoriteGroups.",
      },
    ],
    [
      "a repeated favorite group of one model",
      (file) => {
        Object.assign(file.author.models["boreal-2"].badges[0] ?? {}, {
          groups: ["daily", "daily"],
        });
      },
      {
        model: "boreal-2",
        field: "author.badges.0.groups.1",
        reason: "Группа повторяется.",
      },
    ],
    [
      "a favorite group without models",
      (file) => {
        file.author.favoriteGroups.push({ code: "weekend", title: "Выходные" });
      },
      {
        group: "weekend",
        field: "code",
        reason: "В группе нет моделей: ни один значок favorite её не называет.",
      },
    ],
    [
      "a better pick of an unknown model",
      (file) => {
        file.author.models.fjord.betterPick.models = ["boreal-2", "nobody"];
      },
      {
        model: "fjord",
        field: "author.betterPick.models.1",
        reason: "Модели «nobody» нет в списке models.",
      },
    ],
    [
      "a better pick of the model itself",
      (file) => {
        file.author.models.fjord.betterPick.models = ["fjord"];
      },
      {
        model: "fjord",
        field: "author.betterPick.models.0",
        reason: "«Лучше взять» указывает на саму модель.",
      },
    ],
    [
      "a better pick of one model twice",
      (file) => {
        file.author.models.fjord.betterPick.models = ["delta", "delta"];
      },
      {
        model: "fjord",
        field: "author.betterPick.models.1",
        reason: "Модель повторяется.",
      },
    ],
  ])("rejects %s", (_name, change, error) => {
    const file = syntheticAiModelsReference();
    change(file);

    expect(readAiModelsReferenceFile(file)).toEqual({
      status: "rejected",
      errors: [error],
    });
  });
});

describe("Справочник file text limits", () => {
  it.each<[string, (file: File, value: string) => void, number, object]>([
    [
      "a line of «О данных»",
      (file, value) => {
        file.about[1] = value;
      },
      90,
      { field: "about.1" },
    ],
    [
      "a service name",
      (file, value) => {
        Object.assign(file.services[0] ?? {}, { name: value });
      },
      24,
      { service: "atlas", field: "name" },
    ],
    [
      "a plan name",
      (file, value) => {
        Object.assign(file.plans[0] ?? {}, { name: value });
      },
      20,
      { plan: "atlas-lite", field: "name" },
    ],
    [
      "a model name",
      (file, value) => {
        model(file, 0).name = value;
      },
      24,
      { model: "atlas-pro", field: "name" },
    ],
    [
      "a family",
      (file, value) => {
        model(file, 0).family = value;
      },
      16,
      { model: "atlas-pro", field: "family" },
    ],
    [
      "a summary",
      (file, value) => {
        model(file, 0).summary = value;
      },
      50,
      { model: "atlas-pro", field: "summary" },
    ],
    [
      "an agent name",
      (file, value) => {
        model(file, 0).agent.name = value;
      },
      24,
      { model: "atlas-pro", field: "agent.name" },
    ],
    [
      "an agent reason",
      (file, value) => {
        model(file, 0).agent.reason = value;
      },
      50,
      { model: "atlas-pro", field: "agent.reason" },
    ],
    [
      "alternatives",
      (file, value) => {
        model(file, 0).alternatives = value;
      },
      90,
      { model: "atlas-pro", field: "alternatives" },
    ],
    [
      "a notice",
      (file, value) => {
        model(file, 0).notice = value;
      },
      50,
      { model: "atlas-pro", field: "notice" },
    ],
    [
      "vendor wording",
      (file, value) => {
        Object.assign(model(file, 0).subscriptions[1] ?? {}, {
          vendorWording: value,
        });
      },
      50,
      { model: "atlas-pro", field: "subscriptions.1.vendorWording" },
    ],
    [
      "a note",
      (file, value) => {
        Object.assign(model(file, 0).subscriptions[2] ?? {}, { note: value });
      },
      30,
      { model: "atlas-pro", field: "subscriptions.2.note" },
    ],
    [
      "a favorite group title",
      (file, value) => {
        Object.assign(file.author.favoriteGroups[0] ?? {}, { title: value });
      },
      20,
      { group: "daily", field: "title" },
    ],
    [
      "a ban risk text",
      (file, value) => {
        file.author.services.atlas.text = value;
      },
      60,
      { service: "atlas", field: "author.text" },
    ],
    [
      "a badge text",
      (file, value) => {
        Object.assign(file.author.models["boreal-2"].badges[1] ?? {}, {
          text: value,
        });
      },
      60,
      { model: "boreal-2", field: "author.badges.1.text" },
    ],
    [
      "advice",
      (file, value) => {
        file.author.models.delta.advice = value;
      },
      60,
      { model: "delta", field: "author.advice" },
    ],
    [
      "a better pick reason",
      (file, value) => {
        file.author.models.fjord.betterPick.reason = value;
      },
      30,
      { model: "fjord", field: "author.betterPick.reason" },
    ],
  ])(
    "limits %s in characters, refuses an empty one and one with «|»",
    (_name, change, limit, place) => {
      const reject = (value: string) => {
        const file = syntheticAiModelsReference();
        change(file, value);
        return readAiModelsReferenceFile(file);
      };
      const longest = "ж".repeat(limit);

      expect(reject(longest).status).toBe("valid");
      expect(reject(`${longest}ж`)).toEqual({
        status: "rejected",
        errors: [
          {
            ...place,
            reason: `Знаков ${String(limit + 1)}, лимит ${String(limit)}.`,
          },
        ],
      });
      expect(reject("   ")).toEqual({
        status: "rejected",
        errors: [{ ...place, reason: "Текст пуст." }],
      });
      expect(reject("до | после")).toEqual({
        status: "rejected",
        errors: [
          {
            ...place,
            reason: "Знак «|» не допускается: виджет разделяет им поля строки.",
          },
        ],
      });
    },
  );
});

describe("Справочник file answers to the widget", () => {
  it("rejects a file whose page of a list takes over 1 024 bytes and names the request", () => {
    const file = syntheticAiModelsReference();
    // Three bytes a character: seven rows of «Мощные» no longer fit one answer.
    for (const entry of file.models) entry.summary = "€".repeat(50);

    const errors = rejection(file);

    expect(places(errors)).toContainEqual({ request: "3lp0" });
    expect(errors.find(({ request }) => request === "3lp0")?.reason).toMatch(
      /^Страница 1 фильтра «Мощные»: байт \d{4}, лимит 1024\. Сократите названия или сводки моделей этой страницы\.$/,
    );
    expect(
      errors.every(({ request }) => request?.startsWith("3l") === true),
    ).toBe(true);
  });

  it("rejects a file whose tab «Главное» takes over 1 024 bytes and names the model", () => {
    const file = syntheticAiModelsReference();
    model(file, 0).alternatives = "€".repeat(90);
    model(file, 0).agent.reason = "€".repeat(50);
    model(file, 0).notice = "€".repeat(50);
    Object.assign(file.author.models["atlas-pro"], { advice: "€".repeat(60) });

    const errors = rejection(file);

    expect(places(errors)).toEqual([
      { model: "atlas-pro", request: "3matlas-pro" },
    ]);
    expect(errors[0]?.reason).toMatch(
      /^Вкладка «Главное»: байт \d{4}, лимит 1024\. Сократите тексты модели или мнение автора о ней\.$/,
    );
  });

  it("rejects a file whose tab «Подписки» takes over 1 024 bytes and names the model", () => {
    const file = syntheticAiModelsReference();
    const services = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    for (const code of services) {
      file.services.push({
        code,
        name: "€".repeat(24),
        fromRussia: "unknown",
        russianCard: "unknown",
      });
      file.plans.push({
        code: `${code}-plan`,
        service: code,
        name: "€".repeat(20),
        usdPerMonth: 10,
        priceFrom: false,
      });
    }
    model(file, 6).subscriptions = services.map((code) => ({
      plan: `${code}-plan`,
      vendorWording: "слова",
    }));

    const errors = rejection(file);

    expect(places(errors)).toEqual([{ model: "echo", request: "3secho" }]);
    expect(errors[0]?.reason).toMatch(
      /^Вкладка «Подписки»: байт \d{4}, лимит 1024\. Сократите названия сервисов и тарифов, слова компаний или пояснения\.$/,
    );
  });

  it("rejects a file whose «О данных» takes over 1 024 bytes", () => {
    const file = syntheticAiModelsReference();
    file.about = Array.from({ length: 6 }, () => "€".repeat(90));

    const errors = rejection(file);

    expect(places(errors)).toEqual([{ field: "about", request: "3a" }]);
    expect(errors[0]?.reason).toMatch(
      /^Экран «О данных»: байт \d{4}, лимит 1024\. Сократите строки about\.$/,
    );
  });
});

describe("Справочник file codes that name built-in properties of an object", () => {
  /** The synthetic file with the service «gate» and the model «echo» renamed; neither has an opinion of the author. */
  function renamed(code: string): File {
    const file = syntheticAiModelsReference();
    for (const service of file.services)
      if (service.code === "gate") service.code = code;
    for (const plan of file.plans)
      if (plan.service === "gate") plan.service = code;
    model(file, 6).code = code;
    return file;
  }

  it("accepts a service and a model coded constructor that the author says nothing about", () => {
    const result = readAiModelsReferenceFile(renamed("constructor"));

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    const { reference } = result;
    expect(
      aiModelsResponse(reference, { kind: "card", model: "constructor" })?.[8],
    ).toEqual([]);
    expect(
      aiModelsResponse(reference, { kind: "subscriptions", model: "delta" }),
    ).toMatchObject([
      "s",
      "delta",
      "Delta 1",
      3,
      0,
      1,
      [["Multigate", "", "uu", expect.any(Array)]],
    ]);
  });

  it("rejects a service and a model coded toString like any other code with a capital letter", () => {
    expect(places(rejection(renamed("toString")))).toEqual([
      { service: "№3", field: "code" },
      { model: "№7", field: "code" },
    ]);
  });
});
