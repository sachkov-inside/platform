import { describe, expect, it } from "vitest";

import {
  DAY_MS,
  HOUR_MS,
  addMoscowDays,
  moscowDayOf,
  moscowDayStart,
  moscowDayStartIso,
} from "@/shared/lib/moscow-day";

describe("московские сутки", () => {
  it("называет длительности словами, а не числами на месте вызова", () => {
    expect(HOUR_MS).toBe(3_600_000);
    expect(DAY_MS).toBe(86_400_000);
  });

  it("относит момент к московскому дню, а не к дню UTC", () => {
    expect(moscowDayOf(new Date("2026-10-30T20:59:59.999Z"))).toBe(
      "2026-10-30",
    );
    expect(moscowDayOf(Date.parse("2026-10-30T21:00:00Z"))).toBe("2026-10-31");
  });

  it("начинает сутки в полночь по Москве", () => {
    expect(moscowDayStartIso("2026-10-31")).toBe("2026-10-31T00:00:00+03:00");
    expect(moscowDayStart("2026-10-31").toISOString()).toBe(
      "2026-10-30T21:00:00.000Z",
    );
  });

  it("сдвигает день через границы месяца и года в обе стороны", () => {
    expect(addMoscowDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addMoscowDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMoscowDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMoscowDays("2026-10-27", -29)).toBe("2026-09-28");
  });
});
