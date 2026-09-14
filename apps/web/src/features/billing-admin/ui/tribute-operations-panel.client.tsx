"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { announceEnrollmentChange, billingErrorMessage, subscribeEnrollmentChange } from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { tributeDismissImport, tributeApply, tributePreview, tributeReconcile, tributeRetryEvent, tributeSavePolicy, tributeStatus } from "../api/tribute.browser";
import { listSubscriptionTiers } from "../api/enrollments.browser";
import { applyTributeImportSchema, type tributePreviewSchema } from "../model/tribute-operations";
import { TributeOperationsView } from "./tribute-operations-view.client";

const pendingApplyKey = "inside.tribute.pending-apply.v1";
export function TributeOperationsPanel() {
  const cache = useQueryClient(); const repeat = useRepeatableOperations();
  const [preview, setPreview] = useState<z.infer<typeof tributePreviewSchema> | null>(null);
  const [message, setMessage] = useState(""); const [page, setPage] = useState(0);
  useEffect(() => subscribeEnrollmentChange(() => { void cache.invalidateQueries({ queryKey: ["tribute-operations"] }); }), [cache]);
  const status = useQuery({ queryKey: ["tribute-operations", page], queryFn: async () => {
    const result = await tributeStatus({ operationId: crypto.randomUUID(), page });
    if (!result.ok) throw new Error(billingErrorMessage(result.code));
    return result.value.result.value;
  } });
  const tiers = useQuery({ queryKey: ["tribute-tiers"], queryFn: async () => {
    const result = await listSubscriptionTiers({ operationId: crypto.randomUUID(), limit: 100 });
    if (!result.ok) throw new Error(billingErrorMessage(result.code));
    return result.value.result.items.filter(item => item.availableForAssignment && !item.archived).map(item => item.tier);
  } });
  function refresh() { announceEnrollmentChange(); void cache.invalidateQueries({ queryKey: ["tribute-operations"] }); }
  function failed() { setMessage("Ответ не получен. Повторите то же действие: сохранённая ссылка на операцию защитит от повторного применения."); }
  const policy = useMutation({ mutationFn: tributeSavePolicy, onError: failed, onSuccess: result => {
    if (!result.ok) { setMessage(billingErrorMessage(result.code)); return; }
    repeat.completeOperation("tribute-policy"); setMessage("Правило источника сохранено."); refresh();
  } });
  const previewMutation = useMutation({ mutationFn: tributePreview, onError: failed, onSuccess: result => {
    if (!result.ok) { setMessage(billingErrorMessage(result.code)); return; }
    repeat.completeOperation("tribute-preview"); setPreview(result.value.result.value); setMessage("Проверьте итог каждой строки и выберите строки для применения.");
  } });
  const apply = useMutation({ mutationFn: tributeApply, onError: failed, onSuccess: result => {
    if (!result.ok) { setMessage(billingErrorMessage(result.code)); return; }
    try { sessionStorage.removeItem(pendingApplyKey); } catch { /* The receipt itself remains durable on Platform. */ }
    setPreview(null); setMessage(`Импорт применён. Строк: ${String(result.value.result.value.sources.length)}. Операция: ${result.value.operationRef}.`); refresh();
  } });
  const reconcile = useMutation({ mutationFn: tributeReconcile, onError: failed, onSuccess: result => {
    if (!result.ok) { setMessage(billingErrorMessage(result.code)); return; }
    repeat.completeOperation("tribute-reconcile"); setMessage("Решение по источнику сохранено."); refresh();
  } });
  const dismiss = useMutation({ mutationFn: tributeDismissImport, onError: failed, onSuccess: result => {
    if (!result.ok) { setMessage(billingErrorMessage(result.code)); return; }
    repeat.completeOperation("tribute-dismiss"); setMessage("Оставшиеся строки сверки закрыты с сохранением причины. Права не изменены."); refresh();
  } });
  const inbox = useMutation({ mutationFn: tributeRetryEvent, onError: failed, onSuccess: result => {
    if (!result.ok) { setMessage(billingErrorMessage(result.code)); return; }
    repeat.completeOperation("tribute-inbox"); setMessage(`Событие обработано: ${result.value.result.value.reason}.`); refresh();
  } });
  return <TributeOperationsView data={status.data ?? null} tiers={tiers.data ?? []} preview={preview}
    loading={status.isPending} error={status.error?.message ?? tiers.error?.message ?? null} message={message}
    busy={dismiss.isPending || policy.isPending || previewMutation.isPending || apply.isPending || reconcile.isPending || inbox.isPending}
    onMessage={setMessage} onRefresh={refresh} onPage={setPage}
    onPolicy={input => { policy.mutate({ ...input, operationId: repeat.operationId("tribute-policy", input) }); }}
    onPreview={input => { previewMutation.mutate({ ...input, operationId: repeat.operationId("tribute-preview", input) }); }}
    onApply={selectedRows => {
      if (!preview) return;
      const command = { operationId: repeat.operationId("tribute-apply", { previewRef: preview.previewRef, selectedRows }), previewRef: preview.previewRef, selectedRows };
      try { sessionStorage.setItem(pendingApplyKey, JSON.stringify(command)); }
      catch { setMessage("Браузер не смог сохранить данные восстановления. Разрешите хранилище этой вкладки перед применением."); return; }
      apply.mutate(command);
    }}
    onRecover={() => {
      try {
        const parsed = applyTributeImportSchema.safeParse(JSON.parse(sessionStorage.getItem(pendingApplyKey) ?? "null"));
        if (!parsed.success) { setMessage("В этой вкладке нет незавершённого применения."); return; }
        apply.mutate(parsed.data);
      } catch { setMessage("Не удалось прочитать данные восстановления этой вкладки."); }
    }}
    onReconcile={input => { reconcile.mutate({ ...input, operationId: repeat.operationId("tribute-reconcile", input) }); }}
    onDismiss={input => { dismiss.mutate({ ...input, operationId: repeat.operationId("tribute-dismiss", input) }); }}
    onInbox={input => { inbox.mutate({ ...input, operationId: repeat.operationId("tribute-inbox", input) }); }} />;
}
