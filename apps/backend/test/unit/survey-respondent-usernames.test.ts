import { describe, expect, test } from "vitest";
import {
  normalizeTelegramUsername,
  parseRespondentList,
} from "../../src/modules/billing/domain/telegram-username.js";

describe("ники анкеты", () => {
  test.each([
    ["@Synthetic_Nick", "synthetic_nick"],
    ["synthetic_nick", "synthetic_nick"],
    ["  @synthetic_nick  ", "synthetic_nick"],
    ["t.me/synthetic_nick", "synthetic_nick"],
    ["https://t.me/Synthetic_Nick/", "synthetic_nick"],
    ["http://telegram.me/synthetic_nick?start=1", "synthetic_nick"],
    ['"@synthetic_nick"', "synthetic_nick"],
    ["@ synthetic_nick", "synthetic_nick"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeTelegramUsername(raw)).toBe(expected);
  });

  test.each([
    "respondent@example.test",
    "+7 900 000-00-00",
    "79000000000",
    "Имя Фамилия",
    "@abc",
    "synthetic nick",
    "t.me/",
    "@" + "a".repeat(33),
  ])("%s не ник", (raw) => {
    expect(normalizeTelegramUsername(raw)).toBeNull();
  });

  test("колонка целиком: повторы схлопываются, пустые строки пропускаются, прочее считается", () => {
    expect(
      parseRespondentList(
        "@synthetic_one\r\nsynthetic_one\n\n  \nt.me/synthetic_two\nrespondent@example.test\n+7 900\n",
      ),
    ).toEqual({
      usernames: ["synthetic_one", "synthetic_two"],
      unrecognized: 2,
    });
  });
});
