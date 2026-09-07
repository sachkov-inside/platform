"use client";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { setReadingState } from "../api/reading.browser";
import type { ReadingCommand } from "../model/reading-contract";
import type { ReadingActionView } from "../model/reading-progress-view";
import { ReadingAction } from "./reading-action.client";

export function SavedReadingAction({ materialId, format, canMark = true }: { readonly materialId: string; readonly format: string; readonly canMark?: boolean }) {
  const reading = useMaterialReading(materialId);
  const command = useRef<ReadingCommand | null>(null);
  const [notice, setNotice] = useState<"conflict" | "error" | null>(null);
  const [denied, setDenied] = useState(false);
  const mutation = useMutation({
    mutationKey: ["reading-progress", reading.accountId, "set-state"],
    mutationFn: setReadingState,
    onSuccess: async (result) => {
      if (result.kind === "unavailable") { setNotice("error"); return; }
      command.current = null;
      if (result.kind === "denied") setDenied(true);
      setNotice(result.kind === "conflict" ? "conflict" : result.kind === "saved" ? null : "error");
      await reading.refresh();
    },
    onError: () => { setNotice("error"); },
  });
  const state = reading.state;
  const isRead = state?.isRead === true;
  let view: ReadingActionView;
  if (!reading.resolved) view = { kind: "loading" };
  else if (reading.accountId === null) view = { kind: "anonymous", loginHref: "/account" };
  else if (state === undefined) {
    if (reading.failed) return <div className="mt-6 text-right" role="alert"><p>Не удалось загрузить отметку.</p><button className="min-h-11 text-sm font-semibold text-action" onClick={() => { void reading.refresh(); }} type="button">Повторить</button></div>;
    view = { kind: "loading" };
  } else if (mutation.isPending) view = { kind: "pending", isRead, canMark: canMark && !denied, desiredIsRead: mutation.variables?.isRead ?? !isRead };
  else if (notice === "error") view = { kind: "error", isRead, canMark: canMark && !denied, desiredIsRead: mutation.variables?.isRead ?? !isRead };
  else view = { kind: notice === "conflict" ? "conflict" : "ready", isRead, canMark: canMark && !denied };
  return <ReadingAction format={format} view={view} onRefresh={() => { void reading.refresh().then(() => { setNotice(null); }); }} onSetReadingState={(desired) => {
    if (state === undefined || mutation.isPending) return;
    command.current ??= { materialId, isRead: desired, expectedVersion: state.version, commandId: crypto.randomUUID() };
    setNotice(null);
    mutation.mutate(command.current);
  }} />;
}
