"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { beginTelegramLink } from "../api/begin-telegram-link.browser";
import { confirmTelegramLink } from "../api/confirm-telegram-link.browser";

export function useTelegramLinkFlow(onRefresh: () => Promise<void>) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [automaticConfirmation, setAutomaticConfirmation] = useState(false);
  const automaticLinkRef = useRef<string | null>(null);
  const automaticConfirmInFlight = useRef(false);
  const confirmOnReturn = useRef<() => void>(() => undefined);
  const beginMutation = useMutation({
    mutationFn: beginTelegramLink,
  });
  const confirmMutation = useMutation({
    mutationFn: confirmTelegramLink,
  });
  const refreshMutation = useMutation({ mutationFn: onRefresh });
  const mutationResult = confirmMutation.data ?? beginMutation.data ?? null;
  const pending =
    beginMutation.isPending ||
    confirmMutation.isPending ||
    refreshMutation.isPending;

  const clearAutomaticConfirmation = () => {
    automaticLinkRef.current = null;
    automaticConfirmInFlight.current = false;
    setAutomaticConfirmation(false);
  };

  const begin = async () => {
    beginMutation.reset();
    confirmMutation.reset();
    clearAutomaticConfirmation();
    const telegramWindow = window.open("about:blank", "_blank");
    if (telegramWindow !== null) telegramWindow.opener = null;
    try {
      const result = await beginMutation.mutateAsync();
      if (result.kind === "received" && result.state.deepLink !== undefined) {
        setDeepLink(result.state.deepLink);
        automaticLinkRef.current = result.state.linkRef;
        setAutomaticConfirmation(true);
        if (telegramWindow === null) {
          window.location.assign(result.state.deepLink);
        } else {
          telegramWindow.location.replace(result.state.deepLink);
        }
      } else {
        telegramWindow?.close();
      }
      await onRefresh();
    } catch {
      telegramWindow?.close();
    }
  };

  const runConfirmation = async (linkRef: string, automatic: boolean) => {
    if (automatic && automaticConfirmInFlight.current) return;
    if (automatic) automaticConfirmInFlight.current = true;
    beginMutation.reset();
    confirmMutation.reset();
    try {
      const result = await confirmMutation.mutateAsync(linkRef);
      if (result.kind === "received" && result.state.status !== "pending") {
        setDeepLink(null);
      }
      await onRefresh();
      if (
        automatic &&
        (result.kind !== "received" || result.state.status !== "pending")
      ) {
        clearAutomaticConfirmation();
      } else if (automatic) {
        automaticConfirmInFlight.current = false;
        setAutomaticConfirmation(false);
      }
    } catch {
      if (automatic) clearAutomaticConfirmation();
    } finally {
      if (automatic) automaticConfirmInFlight.current = false;
    }
  };

  const confirm = (linkRef: string) => {
    clearAutomaticConfirmation();
    void runConfirmation(linkRef, false);
  };
  const refresh = () => {
    beginMutation.reset();
    confirmMutation.reset();
    clearAutomaticConfirmation();
    refreshMutation.mutate();
  };

  useEffect(() => {
    confirmOnReturn.current = () => {
      const linkRef = automaticLinkRef.current;
      if (
        linkRef === null ||
        document.visibilityState !== "visible" ||
        automaticConfirmInFlight.current
      ) {
        return;
      }
      void runConfirmation(linkRef, true);
    };
  });

  useEffect(() => {
    const handleReturn = () => {
      confirmOnReturn.current();
    };
    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);
    return () => {
      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);
    };
  }, []);

  return {
    automaticConfirmation,
    begin,
    confirm,
    deepLink,
    mutationResult,
    pending,
    refresh,
  };
}

export type TelegramLinkFlow = ReturnType<typeof useTelegramLinkFlow>;
