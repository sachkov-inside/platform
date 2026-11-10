import { describe, expect, it } from "vitest";

import { trainerRatingName } from "../../src/modules/trainer/trainer-rating.js";
import {
  TELEGRAM_WIDGET_DATA_MAX_BYTES,
  TRAINER_RATING_NAME_MAX_CHARS,
  TRAINER_RATING_ROWS_MAX,
} from "../../src/modules/trainer/widget/trainer-widget-limits.js";
import {
  encodeTrainerWidgetData,
  utf8ByteLength,
} from "../../src/modules/trainer/widget/trainer-widget-wire.js";

describe("a Telegram name in the Rating", () => {
  it("keeps an ordinary name as it is", () => {
    expect(trainerRatingName("Анна Каренина")).toBe("Анна Каренина");
  });

  it("cuts a long name to 24 characters, counting a four-byte sign as one", () => {
    expect(TRAINER_RATING_NAME_MAX_CHARS).toBe(24);
    expect(trainerRatingName("абвгдежзийклмнопрстуфхцчшщ")).toBe(
      "абвгдежзийклмнопрстуфхцч",
    );
    expect(trainerRatingName("😀".repeat(30))).toBe("😀".repeat(24));
    // The cut leaves no space at the end.
    expect(trainerRatingName(`${"я".repeat(23)} Последний`)).toBe(
      "я".repeat(23),
    );
  });

  it("makes one line without control signs, direction overrides and broken pairs", () => {
    expect(trainerRatingName("  Анна\n\tМария\u0000  ")).toBe("Анна Мария");
    expect(
      trainerRatingName(
        `${String.fromCodePoint(0x202e)}Анна${String.fromCodePoint(0x2066)}`,
      ),
    ).toBe("Анна");
    expect(trainerRatingName("Анна\uD83D")).toBe("Анна");
  });

  it("names a person «Без имени» when Telegram gave no sign to show", () => {
    expect(trainerRatingName(null)).toBe("Без имени");
    expect(trainerRatingName(undefined)).toBe("Без имени");
    expect(trainerRatingName(` \n${String.fromCodePoint(0x202e)} `)).toBe(
      "Без имени",
    );
  });

  it("fits the first 7 rows and the person's own row into 1 024 bytes at the longest names, places and points", () => {
    expect(TRAINER_RATING_ROWS_MAX).toBe(8);
    // Quotes and backslashes cost two bytes each, a four-byte sign costs the most.
    const longest = ['"'.repeat(40), "\\".repeat(40), "𝒜".repeat(40)].map(
      (name) => trainerRatingName(name),
    );

    for (const name of longest) {
      const screen = encodeTrainerWidgetData([
        "l",
        1,
        2,
        Array.from({ length: 8 }, () => [9_999_999, name, 999_999, 1]),
      ]);
      expect(utf8ByteLength(screen)).toBeLessThanOrEqual(1024);
    }
    expect(TELEGRAM_WIDGET_DATA_MAX_BYTES).toBe(1024);
  });
});
