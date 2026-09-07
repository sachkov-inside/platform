"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { recordMaterialOpen } from "../api/material-open.browser";
import type { MaterialOpenCommand } from "../model/material-open-contract";

const OPEN_RETRY_DELAY_MS = 1_000;

/** Mounted only around an available Reader. SSR and link prefetch cannot emit this signal. */
export function VisibleMaterialOpen({ materialId, contentVersion, children }: { readonly materialId: string; readonly contentVersion: number; readonly children: ReactNode }) {
  const reader = useRef<HTMLDivElement>(null);
  const currentAccount = useRef<string | null>(null);
  const command = useRef<{ accountId: string; value: MaterialOpenCommand; sent: boolean } | null>(null);
  const reading = useMaterialReading();
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationKey: ["reading-progress", reading.accountId, "open", materialId],
    mutationFn: async (input: { accountId: string; value: MaterialOpenCommand }) => {
      if (currentAccount.current === null) throw new Error("open_identity_pending");
      if (currentAccount.current !== input.accountId) return;
      // A retry completes the already-observed visible open, even if the tab was hidden later.
      const result = await recordMaterialOpen(input.value);
      if (result.kind === "unavailable") throw new Error("open_unavailable");
      if (result.kind === "saved" && currentAccount.current === input.accountId) await queryClient.invalidateQueries({ queryKey: ["reading-progress", input.accountId, "continue"] });
    },
    retry: 2,
    retryDelay: OPEN_RETRY_DELAY_MS,
  });
  useEffect(() => {
    const accountId = reading.resolved ? reading.accountId : null;
    currentAccount.current = accountId;
    if (accountId === null) return;
    if (command.current?.accountId !== accountId) command.current = { accountId, value: { materialId, contentVersion, commandId: crypto.randomUUID() }, sent: false };
    const element = reader.current;
    if (element === null) return;
    let visible = false;
    const send = () => {
      const signal = command.current;
      if (!visible || document.visibilityState !== "visible" || signal === null || signal.sent) return;
      signal.sent = true;
      mutate({ accountId, value: signal.value });
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting === true; send(); });
    observer.observe(element);
    document.addEventListener("visibilitychange", send);
    return () => { currentAccount.current = null; observer.disconnect(); document.removeEventListener("visibilitychange", send); };
  }, [reading.accountId, reading.resolved, materialId, contentVersion, mutate]);
  return <div ref={reader}>{children}</div>;
}
