"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { beginTelegramLink } from "../api/begin-telegram-link.browser";
import { confirmTelegramLink } from "../api/confirm-telegram-link.browser";
import {
  clearTelegramLinkSession,
  resolveTelegramLinkDeepLink,
} from "./telegram-link-session.browser";

interface TelegramLinkBrowser {
  opening: { readonly popup: Window | null } | null;
}

export function useTelegramLinkFlow(onRefresh: () => Promise<void>) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [automaticConfirmation, setAutomaticConfirmation] = useState(false);
  const automaticLinkRef = useRef<string | null>(null);
  const automaticConfirmInFlight = useRef(false);
  const browser = useRef<TelegramLinkBrowser | null>(null);
  const beginMutation = useMutation({
    mutationFn: beginTelegramLink,
  });
  const { reset: resetBegin } = beginMutation;
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
    const active = browser.current;
    if (active?.opening !== null) return;
    resetBegin();
    confirmMutation.reset();
    clearAutomaticConfirmation();
    const telegramWindow = window.open("about:blank", "_blank");
    const opening = { popup: telegramWindow };
    active.opening = opening;
    if (telegramWindow !== null) telegramWindow.opener = null;
    try {
      const result = await beginMutation.mutateAsync();
      if (browser.current !== active) return;
      const resolvedDeepLink =
        result.kind === "received"
          ? resolveTelegramLinkDeepLink(result.state)
          : null;
      setDeepLink(resolvedDeepLink);
      if (result.kind !== "received") clearTelegramLinkSession();
      if (result.kind === "received" && resolvedDeepLink !== null) {
        automaticLinkRef.current = result.state.linkRef;
        setAutomaticConfirmation(true);
        if (telegramWindow === null) {
          window.location.assign(resolvedDeepLink);
        } else {
          telegramWindow.location.replace(resolvedDeepLink);
        }
      } else {
        telegramWindow?.close();
      }
      active.opening = null;
      await onRefresh();
    } catch {
      if (browser.current === active) {
        telegramWindow?.close();
        if (active.opening === opening) active.opening = null;
      }
    }
  };

  const runConfirmation = async (linkRef: string, automatic: boolean) => {
    if (automatic && automaticConfirmInFlight.current) return;
    if (automatic) automaticConfirmInFlight.current = true;
    resetBegin();
    confirmMutation.reset();
    try {
      const result = await confirmMutation.mutateAsync(linkRef);
      if (result.kind === "received" && result.state.status !== "pending") {
        setDeepLink(null);
        clearTelegramLinkSession();
      }
      if (result.kind === "unauthorized") {
        setDeepLink(null);
        clearTelegramLinkSession();
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
    resetBegin();
    confirmMutation.reset();
    clearAutomaticConfirmation();
    refreshMutation.mutate();
  };

  const confirmOnReturn = useEffectEvent(() => {
    const linkRef = automaticLinkRef.current;
    if (
      linkRef === null ||
      document.visibilityState !== "visible" ||
      automaticConfirmInFlight.current
    ) {
      return;
    }
    void runConfirmation(linkRef, true);
  });

  useEffect(() => {
    const active: TelegramLinkBrowser = { opening: null };
    browser.current = active;
    const handleReturn = () => {
      confirmOnReturn();
    };
    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);
    return () => {
      browser.current = null;
      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);
      if (active.opening !== null) {
        active.opening.popup?.close();
        resetBegin();
      }
    };
  }, [resetBegin]);

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
