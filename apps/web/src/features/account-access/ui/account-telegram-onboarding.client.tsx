"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { accountPresentationBrowserQueryOptions } from "../api/account-presentation-query.browser";
import { AccountTelegramLinkPanel } from "./account-telegram-link-panel.client";

const dismissalStorageKey = "inside.telegram-onboarding.dismissed";
const dismissalListeners = new Set<() => void>();

export function AccountTelegramOnboarding({
  authenticated,
  authResolved,
}: {
  readonly authenticated: boolean;
  readonly authResolved: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [journeyStarted, setJourneyStarted] = useState(false);
  const dismissed = useSyncExternalStore(
    subscribeToDismissal,
    readDismissal,
    () => true,
  );
  const options = accountPresentationBrowserQueryOptions();
  const query = useQuery({
    ...options,
    enabled: authResolved && authenticated,
  });

  useEffect(() => {
    if (!authResolved) return;
    if (!authenticated) {
      writeDismissal(false);
    }
  }, [authResolved, authenticated]);

  const presentation =
    query.data?.kind === "ready" ? query.data.presentation : null;
  const journeyOpen =
    authResolved &&
    authenticated &&
    !dismissed &&
    presentation !== null &&
    (presentation.telegramMembership.link.kind !== "linked" ||
      journeyStarted);

  useEffect(() => {
    if (!journeyOpen || dialogRef.current?.open === true) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLElement>("#telegram-onboarding-heading")
      ?.focus();
  }, [journeyOpen, presentation]);

  const dismiss = () => {
    writeDismissal(true);
    setJourneyStarted(false);
  };

  if (!journeyOpen || presentation === null) return null;

  return (
    <dialog
      aria-labelledby="telegram-onboarding-heading"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-[1.75rem] border border-border/70 bg-background p-0 text-foreground shadow-2xl backdrop:bg-foreground/45 backdrop:backdrop-blur-[2px]"
      onClose={dismiss}
      onToggle={(event) => {
        if (event.currentTarget.open) setJourneyStarted(true);
      }}
      ref={dialogRef}
    >
      <AccountTelegramLinkPanel
        link={presentation.telegramMembership.link}
        onClose={() => {
          dialogRef.current?.close();
        }}
        onRefresh={() => query.refetch().then(() => undefined)}
      />
    </dialog>
  );
}

function readDismissal(): boolean {
  return sessionStorage.getItem(dismissalStorageKey) === "true";
}

function subscribeToDismissal(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === dismissalStorageKey) listener();
  };
  dismissalListeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    dismissalListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function writeDismissal(dismissed: boolean): void {
  if (dismissed) {
    sessionStorage.setItem(dismissalStorageKey, "true");
  } else {
    sessionStorage.removeItem(dismissalStorageKey);
  }
  for (const listener of dismissalListeners) listener();
}
