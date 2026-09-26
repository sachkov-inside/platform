import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  consentDocuments,
  currentLegalEdition,
  currentLegalEditions,
  findLegalEdition,
  legalDocumentKeys,
  legalEditionPath,
  legalEditionVersion,
  legalEditions,
  legalSeller,
  LegalTextError,
  parseLegalText,
  supersededLegalEditions,
  termsOfUseDocument,
} from "./index.js";

const origin = "https://inside.sachkov.dev";

describe("published editions", () => {
  it.each(legalEditions.map((edition) => [edition.key, edition] as const))(
    "%s keeps the digest of its accepted text",
    (_key, edition) => {
      expect(createHash("sha256").update(edition.text).digest("hex")).toBe(
        edition.digest,
      );
    },
  );

  it.each(legalEditions.map((edition) => [edition.key, edition] as const))(
    "%s renders as supported blocks",
    (_key, edition) => {
      const blocks = parseLegalText(edition.text);
      const [first] = blocks;
      expect(first).toEqual({
        kind: "heading",
        level: 1,
        content: [{ kind: "text", text: edition.title }],
      });
      expect(blocks.length).toBeGreaterThan(1);
    },
  );

  it.each(legalEditions.map((edition) => [edition.key, edition] as const))(
    "%s states its version and effective date in the text",
    (_key, edition) => {
      expect(edition.text).toContain(
        `Версия ${String(edition.version)}. Действует с `,
      );
      expect(edition.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    },
  );

  it("publishes one current edition for every document", () => {
    expect(currentLegalEditions().map((edition) => edition.key)).toEqual([
      ...legalDocumentKeys,
    ]);
  });

  it("keeps every edition addressable by its own version", () => {
    for (const edition of legalEditions) {
      expect(findLegalEdition(edition.key, edition.version)).toBe(edition);
      expect(legalEditionPath(edition.key, edition.version)).toBe(
        `/legal/${edition.key}/v${String(edition.version)}`,
      );
    }
  });

  it("answers nothing for a version that was never published", () => {
    expect(findLegalEdition("terms", 99)).toBeUndefined();
    expect(supersededLegalEditions("terms")).toEqual([]);
    // Номер 2 оферты разовой покупки занят отклонённым проектом и не публикуется.
    expect(findLegalEdition("purchase", 2)).toBeUndefined();
  });

  it("puts the one-time offer v4 and contacts v2 in force and keeps earlier texts readable", () => {
    expect(currentLegalEdition("purchase").version).toBe(4);
    expect(currentLegalEdition("purchase").text).toContain(
      "в личных сообщениях или по электронной почте",
    );
    expect(currentLegalEdition("purchase").title).toBe(
      "Оферта разовой покупки продукта Inside",
    );
    expect(
      supersededLegalEditions("purchase").map((edition) => edition.version),
    ).toEqual([3, 1]);
    expect(currentLegalEdition("contacts").version).toBe(2);
    expect(currentLegalEdition("contacts").text).toContain(
      "Межрайонная инспекция Федеральной налоговой службы № 46 по г. Москве",
    );
    expect(
      supersededLegalEditions("contacts").map((edition) => edition.version),
    ).toEqual([1]);
  });

  it("puts privacy v3 and cookies v2 in force together with the accepted consent path", () => {
    expect(currentLegalEdition("privacy").version).toBe(3);
    expect(currentLegalEdition("privacy").text).toContain(
      "профиль виден только ему самому",
    );
    expect(
      supersededLegalEditions("privacy").map((edition) => edition.version),
    ).toEqual([2]);
    expect(currentLegalEdition("cookies").version).toBe(2);
    expect(currentLegalEdition("cookies").text).toContain(
      "localStorage `inside.storage-notice.v1`",
    );
    expect(
      supersededLegalEditions("cookies").map((edition) => edition.version),
    ).toEqual([1]);
  });

  it.each(legalEditions.map((edition) => [edition.key, edition] as const))(
    "%s carries no draft marker from its source",
    (_key, edition) => {
      expect(edition.text).not.toMatch(
        /Проект\. Не введён|Проект редакции|Не введён в действие|\[дата|<!--/u,
      );
    },
  );

  it("reads only a version segment", () => {
    expect(legalEditionVersion("v2")).toBe(2);
    expect(legalEditionVersion("2")).toBeUndefined();
    expect(legalEditionVersion("v0")).toBeUndefined();
    expect(legalEditionVersion("v1x")).toBeUndefined();
  });
});

describe("terms of use acceptance", () => {
  it("offers the terms in force at their permanent address", () => {
    const terms = termsOfUseDocument(origin);
    const edition = currentLegalEdition("terms");
    expect(terms).toEqual({
      documentId: "terms",
      version: String(edition.version),
      digest: edition.digest,
      url: `${origin}/legal/terms/v${String(edition.version)}`,
      text: edition.text,
    });
    expect(() => termsOfUseDocument(`${origin}/`)).toThrow(
      "bare public origin",
    );
  });
});

describe("consent catalogue", () => {
  it("addresses each accepted document by its permanent edition address", () => {
    for (const document of consentDocuments(origin))
      expect(document.url).toBe(
        `${origin}/legal/${document.documentId}/v${document.version}`,
      );
  });

  it("gives each payment mode one offer and no policy checkbox", () => {
    const documents = consentDocuments(origin);
    const oneTime = documents.filter((document) =>
      document.appliesTo.includes("one_time"),
    );
    const subscription = documents.filter((document) =>
      document.appliesTo.includes("subscription"),
    );
    expect(oneTime.map((document) => document.documentId)).toEqual([
      "purchase",
    ]);
    expect(subscription.map((document) => document.documentId)).toEqual([
      "subscription",
      "recurring-consent",
    ]);
    expect(
      documents.some((document) => document.kind === "personal_data"),
    ).toBe(false);
  });

  it("keeps one document per kind inside a payment mode", () => {
    for (const mode of ["one_time", "subscription"] as const) {
      const kinds = consentDocuments(origin)
        .filter((document) => document.appliesTo.includes(mode))
        .map((document) => document.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it("addresses the accepted edition on the public site", () => {
    const [purchase] = consentDocuments(origin);
    expect(purchase?.url).toBe("https://inside.sachkov.dev/legal/purchase/v4");
    expect(purchase?.version).toBe("4");
    expect(purchase?.digest).toBe(currentLegalEdition("purchase").digest);
    expect(purchase?.text).toBe(currentLegalEdition("purchase").text);
  });
});

describe("strict text parsing", () => {
  it("reads headings, paragraphs and tables", () => {
    expect(
      parseLegalText(
        "# Заголовок\n\nПервая строка\nвторая строка.\n\n## Раздел\n\n| Что | Зачем |\n| --- | --- |\n| Строка | Значение |\n",
      ),
    ).toEqual([
      {
        kind: "heading",
        level: 1,
        content: [{ kind: "text", text: "Заголовок" }],
      },
      {
        kind: "paragraph",
        content: [{ kind: "text", text: "Первая строка вторая строка." }],
      },
      {
        kind: "heading",
        level: 2,
        content: [{ kind: "text", text: "Раздел" }],
      },
      {
        kind: "table",
        header: [
          [{ kind: "text", text: "Что" }],
          [{ kind: "text", text: "Зачем" }],
        ],
        rows: [
          [
            [{ kind: "text", text: "Строка" }],
            [{ kind: "text", text: "Значение" }],
          ],
        ],
      },
    ]);
  });

  it("reads links, bold and code inside a line", () => {
    expect(
      parseLegalText(
        "Смотри [реквизиты](/legal/contacts), **важно**: `code`.\n",
      ),
    ).toEqual([
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Смотри " },
          { kind: "link", text: "реквизиты", href: "/legal/contacts" },
          { kind: "text", text: ", " },
          { kind: "strong", text: "важно" },
          { kind: "text", text: ": " },
          { kind: "code", text: "code" },
          { kind: "text", text: "." },
        ],
      },
    ]);
  });

  it("accepts an absolute link to an outside address", () => {
    expect(
      parseLegalText("Вход на [сайте](https://auth.sachkov.dev).\n"),
    ).toEqual([
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Вход на " },
          { kind: "link", text: "сайте", href: "https://auth.sachkov.dev" },
          { kind: "text", text: "." },
        ],
      },
    ]);
  });

  it("reads a third-level heading for a subsection", () => {
    expect(parseLegalText("### Что входит\n")).toEqual([
      {
        kind: "heading",
        level: 3,
        content: [{ kind: "text", text: "Что входит" }],
      },
    ]);
  });

  it("reads a numbered list whose items continue on indented lines", () => {
    expect(
      parseLegalText(
        "Покупка включает:\n\n1. **Материалы** — тексты\n   и видео.\n2. Общий [чат](/legal/terms).\n",
      ),
    ).toEqual([
      {
        kind: "paragraph",
        content: [{ kind: "text", text: "Покупка включает:" }],
      },
      {
        kind: "list",
        ordered: true,
        items: [
          [
            { kind: "strong", text: "Материалы" },
            { kind: "text", text: " — тексты и видео." },
          ],
          [
            { kind: "text", text: "Общий " },
            { kind: "link", text: "чат", href: "/legal/terms" },
            { kind: "text", text: "." },
          ],
        ],
      },
    ]);
  });

  it("reads a bulleted list", () => {
    expect(
      parseLegalText("- Первый пункт;\n- второй пункт\n  с продолжением.\n"),
    ).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          [{ kind: "text", text: "Первый пункт;" }],
          [{ kind: "text", text: "второй пункт с продолжением." }],
        ],
      },
    ]);
  });

  it.each([
    ["#### Четвёртый уровень\n", "unsupported heading"],
    ["Абзац\n- пункт\n", "list must start after a blank line"],
    ["- пункт\nбез отступа\n", "list item continuation must be indented"],
    ["- пункт\n1. другой вид\n", "list mixes numbered and bulleted items"],
    ["1. первый\n3. третий\n", "numbered list must count from 1 without gaps"],
    ["2. второй\n", "numbered list must count from 1 without gaps"],
    ["- пункт\n  - вложенный\n", "nested lists are not supported"],
    ["> цитата\n", "quote blocks are not supported"],
    ["* звёздочка\n", "unsupported list marker"],
    ["Файловая [ссылка](contacts-v1.md).\n", "unsupported link target"],
    ["Текст со `непарным маркером.\n", "unbalanced code marker"],
    ["Текст с **непарным маркером.\n", "unbalanced bold marker"],
    ["| Что | Зачем |\n| Строка | Значение |\n", "delimiter row is missing"],
    ["| Что | Зачем |\n| --- | --- |\n", "table has no rows"],
    ["Абзац\n| Что |\n", "paragraph must end with a blank line"],
    ["", "text has no blocks"],
  ])("rejects %j", (text, message) => {
    expect(() => parseLegalText(text)).toThrow(LegalTextError);
    expect(() => parseLegalText(text)).toThrow(message);
  });
});

describe("seller", () => {
  it("short seller facts repeat the published contacts edition", () => {
    const contacts = currentLegalEdition("contacts").text;

    expect(contacts).toContain("Сачков Кирилл Олегович");
    expect(contacts).toContain(legalSeller.inn);
    expect(contacts).toContain(legalSeller.ogrnip);
    expect(contacts).toContain(legalSeller.email);
  });
});
