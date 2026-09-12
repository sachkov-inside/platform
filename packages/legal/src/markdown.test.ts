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
  LegalTextError,
  parseLegalText,
  supersededLegalEditions,
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
  });

  it("reads only a version segment", () => {
    expect(legalEditionVersion("v2")).toBe(2);
    expect(legalEditionVersion("2")).toBeUndefined();
    expect(legalEditionVersion("v0")).toBeUndefined();
    expect(legalEditionVersion("v1x")).toBeUndefined();
  });
});

describe("consent catalogue", () => {
  it("gives each payment mode one offer and no policy checkbox", () => {
    const documents = consentDocuments(origin);
    const oneTime = documents.filter((document) =>
      document.appliesTo.includes("one_time"),
    );
    const subscription = documents.filter((document) =>
      document.appliesTo.includes("subscription"),
    );
    expect(oneTime.map((document) => document.documentId)).toEqual(["purchase"]);
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
    expect(purchase?.url).toBe("https://inside.sachkov.dev/legal/purchase");
    expect(purchase?.version).toBe("1");
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
      { kind: "heading", level: 1, content: [{ kind: "text", text: "Заголовок" }] },
      {
        kind: "paragraph",
        content: [{ kind: "text", text: "Первая строка вторая строка." }],
      },
      { kind: "heading", level: 2, content: [{ kind: "text", text: "Раздел" }] },
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
      parseLegalText("Смотри [реквизиты](/legal/contacts), **важно**: `code`.\n"),
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

  it.each([
    ["### Третий уровень\n", "unsupported heading"],
    ["- список\n", "list and quote blocks are not supported"],
    ["1. пункт\n", "list and quote blocks are not supported"],
    ["> цитата\n", "list and quote blocks are not supported"],
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
