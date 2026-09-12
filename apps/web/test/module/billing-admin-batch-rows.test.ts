import { expect, it } from "vitest";

import { parseBatchRows } from "@/features/billing-admin/ui/grants-section.client";
import { batchRowSchema } from "@/features/billing-admin/model/admin-operations";

const accountId = "00000000-0000-4000-8000-0000000000c1";

it("разбирает выдачу и классификацию одного набора по виду строки", () => {
  const parsed = parseBatchRows(
    [
      `grant | ${accountId} | manual | manual-1 | materials, community | 2026-09-01T09:00:00.000Z | null | Ручная выдача`,
      `classify | ${accountId} | confirmed_new | cohort-1 | 0 | нет | нет | Перенос участника`,
    ].join("\n"),
  );
  expect(parsed.invalid).toEqual([]);
  expect(parsed.rows).toEqual([
    {
      rowKey: "grant",
      accountId,
      source: "manual",
      sourceRef: "manual-1",
      terms: {
        capabilities: ["materials", "community"],
        startsAt: "2026-09-01T09:00:00.000Z",
        validUntil: null,
        reason: "Ручная выдача",
      },
    },
    {
      rowKey: "classify",
      accountId,
      expectedRevision: 0,
      classification: "confirmed_new",
      sourceRef: "cohort-1",
      reason: "Перенос участника",
      bridgeEnabled: false,
      tributeStopped: false,
    },
  ]);
  // Обе строки принимает та же схема, что уходит владельческой командой.
  for (const row of parsed.rows) expect(batchRowSchema.safeParse(row).success).toBe(true);
});

it("отмечает переход старой группы только отмеченным признаком", () => {
  const parsed = parseBatchRows(
    `legacy | ${accountId} | confirmed_legacy | tribute-1 | 2 | да | да | Выгрузка старой группы`,
  );
  expect(parsed.rows).toEqual([
    {
      rowKey: "legacy",
      accountId,
      expectedRevision: 2,
      classification: "confirmed_legacy",
      sourceRef: "tribute-1",
      reason: "Выгрузка старой группы",
      bridgeEnabled: true,
      tributeStopped: true,
    },
  ]);
});

it("не отправляет строку классификации без разборчивой редакции", () => {
  const parsed = parseBatchRows(
    [
      `bad | ${accountId} | confirmed_new | cohort-2 | позже | нет | нет | Перенос участника`,
      `negative | ${accountId} | confirmed_new | cohort-3 | -1 | нет | нет | Перенос участника`,
      `short | ${accountId} | confirmed_new | cohort-4 | 0`,
    ].join("\n"),
  );
  expect(parsed.rows).toEqual([]);
  expect(parsed.invalid).toEqual(["bad", "negative", "short"]);
});
