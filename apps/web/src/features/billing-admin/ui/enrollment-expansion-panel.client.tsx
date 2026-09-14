"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { announceEnrollmentChange, billingErrorMessage, type Enrollment } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";
import { applyEnrollmentExpansion, previewEnrollmentExpansion } from "../api/enrollments.browser";
import type { expansionPreviewSchema} from "../model/enrollment-operations";
import { type tiersOutcomeSchema } from "../model/enrollment-operations";
import { formText, AdminField } from "./admin-form.client";
export function EnrollmentExpansionPanel({ items, tiers }: { readonly items: readonly Enrollment[]; readonly tiers: z.infer<typeof tiersOutcomeSchema>["result"]["items"] }) {
  const [preview, setPreview] = useState<z.infer<typeof expansionPreviewSchema>>(); const [error, setError] = useState<string>(); const [notice, setNotice] = useState<string>();
  const repeat = useRepeatableOperations(); const cache = useQueryClient();
  const prepare = useMutation({ mutationFn: previewEnrollmentExpansion, onSuccess: result => { if (!result.ok) { setError(billingErrorMessage(result.code)); return; } setError(undefined); setPreview(result.value.result.value); repeat.completeOperation("preview-expansion"); } });
  const apply = useMutation({ mutationFn: applyEnrollmentExpansion, onSuccess: result => { if (!result.ok) { setError(billingErrorMessage(result.code)); return; } setPreview(undefined); setError(undefined); setNotice("Состав расширен только у выбранных назначений. Сроки и отзывы сохранены."); repeat.completeOperation("apply-expansion"); announceEnrollmentChange(); void cache.invalidateQueries({ queryKey: ["owner-enrollments"] }); } });
  return <div className="grid gap-4 border-t border-border pt-5"><h3 className="text-lg font-semibold">Расширить состав выбранных назначений</h3><p className="text-sm text-muted-foreground">Сначала сохраните новую редакцию того же тарифа. Предпросмотр проверит, что прежние права не сокращаются.</p>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    <form className="grid gap-4" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const tier = tiers.find(item => item.tier.id === form.get("tier")); const selected = new Set(form.getAll("enrollment")); const targets = items.filter(item => selected.has(item.id)).map(item => ({ enrollmentId: item.id, expectedRevision: item.revision, tierRevision: item.tier.revision })); if (!tier || targets.length === 0) { setError("Выберите тариф и хотя бы одно назначение."); return; } const command = { tierId: tier.tier.id, tierRevision: tier.tier.revision, targets, reason: formText(form.get("reason")) }; setPreview(undefined); prepare.mutate({ ...command, operationId: repeat.operationId("preview-expansion", command) }); }}>
      <label className="grid gap-1 text-sm">Новая редакция тарифа<select name="tier" required className="min-w-0 w-full min-h-11 rounded-xl border border-input bg-background px-3">{tiers.map(item => <option key={item.tier.id} value={item.tier.id}>{item.tier.name} · редакция {item.tier.revision}</option>)}</select></label>
      <fieldset className="grid gap-2"><legend className="mb-2 text-sm">Назначения этого аккаунта</legend>{items.map(item => <label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" name="enrollment" value={item.id} />{item.tier.name} · редакция {item.tier.revision} · {item.origin}</label>)}</fieldset>
      <AdminField label="Причина расширения" name="reason" required /><Button type="submit" disabled={prepare.isPending || apply.isPending}>Проверить расширение</Button>
    </form>
    {preview ? <div role="status" className="grid gap-3 rounded-xl border border-border p-4"><p>Будет обновлено назначений: {preview.targets.length}. Состав: {preview.tier.contentScope.guideIds.length} гайдов, {preview.tier.contentScope.materialIds.length} материалов. Права: {preview.tier.benefits.join(", ")}.</p><p>Сроки назначения и состояние отзыва сохранятся. Предпросмотр действует до {new Date(preview.expiresAt).toLocaleTimeString("ru-RU")}.</p><Button disabled={apply.isPending} onClick={() => { const command = { previewRef: preview.previewRef }; apply.mutate({ ...command, operationId: repeat.operationId("apply-expansion", command) }); }}>Применить проверенное расширение</Button></div> : null}
  </div>;
}
