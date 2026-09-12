"use client";
import { useState } from "react";

import {
  billingActionClass,
  formatBillingDate,
  formatBillingDateTime,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import { accountClassificationSchema } from "../model/admin-operations";
import type {
  AccessGrantView,
  ApplyBatchInput,
  ExtendGrantInput,
  GrantBatchOutcome,
  GrantPreviewOutcome,
  GrantsOutcome,
  PreviewBatchInput,
  RevokeGrantInput,
} from "../model/admin-operations";
import type { AdminCommand } from "./admin-command";
import {
  AdminField,
  AdminSection,
  AdminTextArea,
  capabilityHint,
  formText,
  onAdminSubmit,
  optionalFormText,
  parseCapabilities,
  reasonMaxLength,
} from "./admin-form.client";

export interface GrantsSectionProps {
  readonly grants: GrantsOutcome["result"]["value"] | null;
  readonly preview: GrantPreviewOutcome["result"] | null;
  readonly batch: GrantBatchOutcome["result"] | null;
  readonly pending: boolean;
  readonly onReadGrants: (input: { readonly accountId: string }) => void;
  readonly onExtendGrant: (input: AdminCommand<ExtendGrantInput>) => void;
  readonly onRevokeGrant: (input: AdminCommand<RevokeGrantInput>) => void;
  readonly onPreviewBatch: (input: AdminCommand<PreviewBatchInput>) => void;
  readonly onApplyBatch: (input: AdminCommand<ApplyBatchInput>) => void;
}

export function GrantsSection({
  grants,
  preview,
  batch,
  pending,
  onReadGrants,
  onExtendGrant,
  onRevokeGrant,
  onPreviewBatch,
  onApplyBatch,
}: GrantsSectionProps) {
  const [rowsError, setRowsError] = useState<string>();
  return (
    <>
      <AdminSection
        description="Ручные и унаследованные основания живут отдельно от оплаченных: отзыв одного не трогает остальные."
        title="Права участника"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            onReadGrants({ accountId: formText(form.get("grantsAccount")) });
          })}
        >
          <AdminField label="Account" name="grantsAccount" required />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Показать права
            </Button>
          </p>
        </form>

        {grants === null ? null : (
          <div className="grid gap-3 border-t border-border pt-5 text-sm">
            {grants.grants.length === 0 ? (
              <p className="text-muted-foreground">Оснований нет.</p>
            ) : (
              <ul className="grid gap-3">
                {grants.grants.map((grant) => (
                  <GrantRow grant={grant} key={grant.grantRef} />
                ))}
              </ul>
            )}
          </div>
        )}

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={onAdminSubmit((form) => {
            const validUntil = optionalFormText(form.get("extendUntil"));
            onExtendGrant({
              grantRef: formText(form.get("extendGrant")),
              expectedRevision: Number(formText(form.get("extendRevision"))),
              reason: formText(form.get("extendReason")),
              validUntil: validUntil ?? null,
            });
          })}
        >
          <AdminField label="Продлить основание" name="extendGrant" required />
          <AdminField
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="extendRevision"
            required
          />
          <AdminField
            hint="ISO 8601 со смещением; пусто — бессрочно."
            label="Действует до"
            name="extendUntil"
          />
          <AdminTextArea
            label="Основание"
            maxLength={reasonMaxLength}
            name="extendReason"
            required
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Продлить
            </Button>
          </p>
        </form>

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={onAdminSubmit((form) => {
            onRevokeGrant({
              grantRef: formText(form.get("revokeGrant")),
              expectedRevision: Number(formText(form.get("revokeRevision"))),
              reason: formText(form.get("revokeReason")),
            });
          })}
        >
          <AdminField label="Отозвать основание" name="revokeGrant" required />
          <AdminField
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="revokeRevision"
            required
          />
          <AdminTextArea
            label="Основание"
            maxLength={reasonMaxLength}
            name="revokeReason"
            required
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
              variant="outline"
            >
              Отозвать
            </Button>
          </p>
        </form>
      </AdminSection>

      <AdminSection
        description="Предпросмотр ничего не выдаёт и никого не определяет: он только сопоставляет строки с Account. Применяются только подтверждённые строки того же предпросмотра."
        title="Массовая выдача и классификация"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            const parsed = parseBatchRows(formText(form.get("batchRows")));
            if (parsed.invalid.length > 0 || parsed.rows.length === 0) {
              setRowsError(
                parsed.rows.length === 0 && parsed.invalid.length === 0
                  ? "Не удалось разобрать ни одной строки."
                  : `Неполные строки, неизвестное право или редакция: ${parsed.invalid.join("; ")}. ${capabilityHint}`,
              );
              return;
            }
            setRowsError(undefined);
            onPreviewBatch({ rows: parsed.rows });
          })}
        >
          <AdminTextArea
            hint={`Выдача: rowKey | accountId | manual|legacy | sourceRef | права через запятую | startsAt | validUntil или null | основание. Классификация: rowKey | accountId | confirmed_new|confirmed_legacy|unknown | sourceRef | ожидаемая редакция | переход да|нет | Tribute остановлен да|нет | основание. ${capabilityHint}`}
            label="Строки"
            name="batchRows"
            required
            rows={6}
          />
          {rowsError === undefined ? null : (
            <p className="text-sm text-destructive" role="alert">
              {rowsError}
            </p>
          )}
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Собрать предпросмотр
            </Button>
          </p>
        </form>

        {preview === null ? null : (
          <div className="border-t border-border pt-5 text-sm">
            <p className="font-mono text-xs [overflow-wrap:anywhere]">
              {preview.previewRef} · r{preview.revision} · до{" "}
              {formatBillingDateTime(preview.expiresAt)}
            </p>
            <ul className="mt-3 grid gap-1">
              {preview.rows.map((row) => (
                <li key={row.rowKey}>
                  {row.rowKey} ·{" "}
                  {row.status === "confirmed" ? "найден" : "не найден"}
                </li>
              ))}
            </ul>
            <Button
              className={`mt-3 ${billingActionClass}`}
              disabled={
                pending ||
                preview.rows.every((row) => row.status !== "confirmed")
              }
              onClick={() => {
                onApplyBatch({
                  previewRef: preview.previewRef,
                  expectedRevision: preview.revision,
                  confirmedRows: preview.rows
                    .filter((row) => row.status === "confirmed")
                    .map((row) => row.rowKey),
                });
              }}
              type="button"
            >
              Применить подтверждённые строки
            </Button>
          </div>
        )}

        {batch === null ? null : (
          <ul className="grid gap-1 border-t border-border pt-5 text-sm">
            {batch.rows.map((row) => (
              <li key={row.rowKey}>
                {row.rowKey} · {batchRowOutcome(row.result)}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </>
  );
}

function GrantRow({ grant }: { readonly grant: AccessGrantView }) {
  return (
    <li className="grid gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="font-mono text-xs [overflow-wrap:anywhere]">
        {grant.grantRef} · r{grant.revision} · {grant.source}
      </span>
      <span>
        {grant.capabilities.join(", ")} ·{" "}
        {grant.validUntil === null
          ? "бессрочно"
          : `до ${formatBillingDate(grant.validUntil)}`}{" "}
        · {grant.active ? "действует" : "не действует"}
      </span>
      <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {grant.reason}
      </span>
    </li>
  );
}

/** Исход строки набора: выданное основание или новое состояние покупателя. */
function batchRowOutcome(result: GrantBatchOutcome["result"]["rows"][number]["result"]): string {
  if (!result.ok) return "конфликт операции";
  return "classification" in result
    ? `определён, r${String(result.revision)}`
    : `выдано, r${String(result.revision)}`;
}

/** Отмеченный признак записывается словом: пустая ячейка остаётся выключенной. */
function flag(cell: string): boolean {
  return cell === "да";
}

/**
 * Одна строка набора описывает ровно один Account: либо его основание, либо его классификацию.
 * Вид строки читается по третьей ячейке, поэтому владелец ведёт оба списка в одном месте.
 */
export function parseBatchRows(value: string): {
  readonly rows: PreviewBatchInput["rows"];
  readonly invalid: readonly string[];
} {
  const rows: PreviewBatchInput["rows"][number][] = [];
  const invalid: string[] = [];
  for (const line of value.split("\n")) {
    if (line.trim().length === 0) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const rowKey = cells[0] ?? line.trim();
    if (cells.length < 8) {
      invalid.push(rowKey);
      continue;
    }
    const classification = accountClassificationSchema.safeParse(cells[2] ?? "");
    if (classification.success) {
      // Пустая ячейка редакции — не ноль: иначе набор молча ушёл бы на конфликт при применении.
      const cell = cells[4] ?? "";
      const expectedRevision = cell.length === 0 ? Number.NaN : Number(cell);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        invalid.push(rowKey);
        continue;
      }
      rows.push({
        rowKey: cells[0] ?? "",
        accountId: cells[1] ?? "",
        classification: classification.data,
        sourceRef: cells[3] ?? "",
        expectedRevision,
        bridgeEnabled: flag(cells[5] ?? ""),
        tributeStopped: flag(cells[6] ?? ""),
        reason: cells[7] ?? "",
      });
      continue;
    }
    const capabilities = parseCapabilities(cells[4] ?? "");
    if (capabilities.invalid.length > 0 || capabilities.capabilities.length === 0) {
      invalid.push(rowKey);
      continue;
    }
    rows.push({
      rowKey: cells[0] ?? "",
      accountId: cells[1] ?? "",
      source: cells[2] === "legacy" ? "legacy" : "manual",
      sourceRef: cells[3] ?? "",
      terms: {
        capabilities: [...capabilities.capabilities],
        startsAt: cells[5] ?? "",
        validUntil: cells[6] === "null" ? null : (cells[6] ?? null),
        reason: cells[7] ?? "",
      },
    });
  }
  return { rows, invalid };
}
