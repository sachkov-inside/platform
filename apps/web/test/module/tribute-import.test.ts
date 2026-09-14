import { describe, expect, test } from "vitest";
import { parseTributeCsv, tributeCsvColumns, tributeCsvTemplate } from "../../src/features/billing-admin/model/tribute-import";
const cells = ["row-1", "approved-roster", "625001", "verified-identity", "625001", "operator-evidence", "2030-01-01T00:00:00.000Z", "confirmed_period", "2030-01-01T00:00:00.000Z", "2030-02-01T00:00:00.000Z", "unknown", "0", "Verified period"];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
describe("Tribute CSV input boundary", () => {
  test("quoted delimiters, escaped quotes, CRLF and Cyrillic preserve the operator evidence", () => {
    const row = [...cells]; row[12] = 'Проверено, ссылка "источник"\nдополнение';
    const result = parseTributeCsv(`\uFEFF${tributeCsvTemplate}${row.map(quote).join(",")}\r\n`);
    expect(result[0]).toMatchObject({ reason: row[12], endsAt: cells[9], expectedRevision: 0 });
  });
  test("unknown dates and identity stay unknown, never inferred from other fields", () => {
    const row = [...cells]; for (const index of [3, 4, 5, 8, 9]) row[index] = "";
    expect(parseTributeCsv(tributeCsvTemplate + row.join(","))[0]).toMatchObject({ identityRef: null, telegramUserId: null, verificationRef: null, startsAt: null, endsAt: null });
  });
  test("rejects malformed quoting, missing headers, invalid dates and unbounded batches", () => {
    expect(() => parseTributeCsv(tributeCsvTemplate + '"unclosed')).toThrow();
    expect(() => parseTributeCsv(cells.join(","))).toThrow();
    const invalid = [...cells]; invalid[9] = "September 5";
    expect(() => parseTributeCsv(tributeCsvTemplate + invalid.join(","))).toThrow(/UTC/u);
    expect(() => parseTributeCsv(tributeCsvTemplate + Array.from({ length: 101 }, () => cells.join(",")).join("\n"))).toThrow(/100/u);
    expect(() => parseTributeCsv(tributeCsvColumns.toReversed().join(",") + "\n" + cells.join(","))).toThrow();
  });
});
