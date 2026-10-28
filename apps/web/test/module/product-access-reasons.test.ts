import { describe, expect, it } from "vitest";

import {
  ACCESS_REASON_MAX_CHARACTERS,
  encodeAccessReason,
  encodeRestoreReason,
  grantReasons,
  reasonNoteMaxCharacters,
  revokeReasons,
} from "@/entities/product-access";
import { revocationConsequence } from "@/features/product-access-actions/model/revocation-consequence";

describe("access reasons", () => {
  it("offers one list of revoke and grant choices to every access dialog", () => {
    expect(revokeReasons.map((option) => option.label)).toEqual([
      "Возврат оплаты",
      "Нарушение правил",
      "Выдано по ошибке",
      "По просьбе человека",
      "Другое",
    ]);
    expect(grantReasons.map((option) => option.label)).toEqual([
      "Подарок",
      "Компенсация или решение поддержки",
      "Оплата вне сайта",
      "Перенос оплаты",
      "Команда и партнёры",
      "Другое",
    ]);
  });

  it("encodes a listed reason as its label and appends an optional note", () => {
    expect(
      encodeAccessReason(revokeReasons, {
        reason: "Возврат оплаты",
        note: "   ",
      }),
    ).toEqual({ ok: true, text: "Возврат оплаты" });
    expect(
      encodeAccessReason(grantReasons, {
        reason: "Оплата вне сайта",
        note: "  перевод\n на счёт  в октябре ",
      }),
    ).toEqual({
      ok: true,
      text: "Оплата вне сайта: перевод на счёт в октябре",
    });
  });

  it("requires a note for «Другое» and keeps it after the label", () => {
    expect(
      encodeAccessReason(revokeReasons, { reason: "Другое", note: " " }),
    ).toEqual({ ok: false, error: "note_required" });
    expect(
      encodeAccessReason(revokeReasons, {
        reason: "Другое",
        note: "Попросил партнёр",
      }),
    ).toEqual({ ok: true, text: "Другое: Попросил партнёр" });
  });

  it("refuses a reason outside the choices", () => {
    expect(
      encodeAccessReason(grantReasons, {
        reason: "Нарушение правил",
        note: "",
      }),
    ).toEqual({ ok: false, error: "reason_required" });
    expect(
      encodeAccessReason(revokeReasons, { reason: "", note: "x" }),
    ).toEqual({ ok: false, error: "reason_required" });
  });

  it("keeps every encoded reason within the Product Access limit", () => {
    for (const choices of [revokeReasons, grantReasons]) {
      const limit = reasonNoteMaxCharacters(choices);
      for (const option of choices) {
        const fits = encodeAccessReason(choices, {
          reason: option.value,
          note: "я".repeat(limit),
        });
        expect(fits.ok).toBe(true);
        if (fits.ok)
          expect(fits.text.length).toBeLessThanOrEqual(
            ACCESS_REASON_MAX_CHARACTERS,
          );
      }
    }
    expect(
      encodeAccessReason(revokeReasons, {
        reason: "Другое",
        note: "я".repeat(ACCESS_REASON_MAX_CHARACTERS),
      }),
    ).toEqual({ ok: false, error: "too_long" });
  });

  it("takes a restore reason as required free text", () => {
    expect(encodeRestoreReason("  Оплата нашлась \n в банке ")).toEqual({
      ok: true,
      text: "Оплата нашлась в банке",
    });
    expect(encodeRestoreReason(" \n ")).toEqual({
      ok: false,
      error: "note_required",
    });
    expect(
      encodeRestoreReason("я".repeat(ACCESS_REASON_MAX_CHARACTERS + 1)),
    ).toEqual({ ok: false, error: "too_long" });
  });
});

describe("revocation consequence", () => {
  it("names the group only as the server's preview answers", () => {
    expect(revocationConsequence("closes")).toEqual([
      "Материалы продукта закроются.",
      "Группа в Telegram закроется: у человека не останется другого продукта с группой.",
      "Остальные продукты, история, оплаты и учебные записи сохранятся.",
    ]);
    expect(revocationConsequence("remains")[1]).toBe(
      "Группа в Telegram останется: её даёт другой продукт человека.",
    );
  });
});
