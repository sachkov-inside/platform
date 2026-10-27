import { describe, expect, test } from "vitest";

import {
  overviewPeriod,
  seriesOf,
} from "../../../src/modules/authoring-overview/domain/overview-period.js";

describe("Overview period (#1719)", () => {
  test("Moscow days: the current period ends today, the previous one right before it", () => {
    // 2026-10-07 23:59:59.999 in Moscow is still the 7th.
    expect(overviewPeriod(new Date("2026-10-07T20:59:59.999Z"), 7)).toEqual({
      days: 7,
      timeZone: "Europe/Moscow",
      current: {
        from: "2026-09-30T21:00:00.000Z",
        to: "2026-10-07T21:00:00.000Z",
        firstDay: "2026-10-01",
        lastDay: "2026-10-07",
      },
      previous: {
        from: "2026-09-23T21:00:00.000Z",
        to: "2026-09-30T21:00:00.000Z",
        firstDay: "2026-09-24",
        lastDay: "2026-09-30",
      },
    });
  });

  test("Moscow midnight starts the next day while UTC is still on the previous one", () => {
    const period = overviewPeriod(new Date("2026-10-07T21:00:00.000Z"), 30);
    expect(period.current).toEqual({
      from: "2026-09-08T21:00:00.000Z",
      to: "2026-10-08T21:00:00.000Z",
      firstDay: "2026-09-09",
      lastDay: "2026-10-08",
    });
    expect(period.previous.lastDay).toBe("2026-09-08");
    expect(period.previous.firstDay).toBe("2026-08-10");
  });

  test("a series has every day of its range, zeros included, and sums them", () => {
    const period = overviewPeriod(new Date("2026-10-07T09:00:00.000Z"), 7);
    expect(
      seriesOf(period.current, [
        { date: "2026-10-02", value: 5 },
        { date: "2026-10-07", value: -2 },
        { date: "2026-09-30", value: 100 },
      ]),
    ).toEqual({
      total: 3,
      daily: [
        { date: "2026-10-01", value: 0 },
        { date: "2026-10-02", value: 5 },
        { date: "2026-10-03", value: 0 },
        { date: "2026-10-04", value: 0 },
        { date: "2026-10-05", value: 0 },
        { date: "2026-10-06", value: 0 },
        { date: "2026-10-07", value: -2 },
      ],
    });
  });
});
