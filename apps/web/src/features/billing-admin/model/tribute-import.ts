import { tributeImportRowSchema } from "./tribute-operations";

export const tributeCsvColumns = ["rowRef", "policyRef", "subscriptionId", "identityRef", "telegramUserId", "verificationRef", "checkedAt", "mode", "startsAt", "endsAt", "renewal", "expectedRevision", "reason"] as const;
export const tributeCsvTemplate = `${tributeCsvColumns.join(",")}\r\n`;

/** RFC 4180 cells only; no spreadsheet formulas, date inference or amount-to-period conversion. */
export function parseTributeCsv(text: string) {
  if (text.length > 262144) throw new Error("Файл должен быть не больше 256 КБ.");
  const records: string[][] = []; let record: string[] = []; let cell = ""; let quoted = false; let closed = false;
  const source = text.replace(/^\uFEFF/u, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? "";
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"' && cell === "" && !closed) quoted = true;
    else if (char === ",") { record.push(cell); cell = ""; closed = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      record.push(cell); records.push(record); record = []; cell = ""; closed = false;
    } else if (closed || char === '"') throw new Error("Неверные кавычки в CSV.");
    else cell += char;
  }
  if (quoted) throw new Error("В CSV не закрыты кавычки.");
  if (cell !== "" || record.length > 0 || closed) { record.push(cell); records.push(record); }
  const header = records.shift();
  if (JSON.stringify(header) !== JSON.stringify(tributeCsvColumns)) throw new Error("Названия и порядок столбцов должны совпадать с шаблоном.");
  if (records.length === 0 || records.length > 100) throw new Error("В одном импорте должно быть от 1 до 100 строк.");
  return records.map((cells, index) => {
    if (cells.length !== tributeCsvColumns.length) throw new Error(`Строка ${String(index + 2)}: неверное количество столбцов.`);
    const input = Object.fromEntries(tributeCsvColumns.map((key, column) => [key, cells[column]?.trim() ?? ""]));
    const parsed = tributeImportRowSchema.safeParse({ ...input,
      subscriptionId: input.subscriptionId === "" ? null : Number(input.subscriptionId), expectedRevision: Number(input.expectedRevision),
      identityRef: input.identityRef === "" ? null : input.identityRef, telegramUserId: input.telegramUserId === "" ? null : input.telegramUserId, verificationRef: input.verificationRef === "" ? null : input.verificationRef,
      startsAt: input.startsAt === "" ? null : input.startsAt, endsAt: input.endsAt === "" ? null : input.endsAt });
    if (!parsed.success) throw new Error(`Строка ${String(index + 2)}: проверьте ${parsed.error.issues.map(issue => issue.path.join(".")).join(", ")}. Даты указываются в UTC, например 2030-01-01T00:00:00.000Z.`);
    return parsed.data;
  });
}
