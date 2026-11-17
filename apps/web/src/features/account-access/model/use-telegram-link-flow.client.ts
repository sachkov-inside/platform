"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { beginTelegramLink } from "../api/begin-telegram-link.browser";
import { confirmTelegramLink } from "../api/confirm-telegram-link.browser";
import { accountPresentationQueryKey } from "./account-presentation-query";
import type { TelegramLinkMutationResult } from "./account-telegram-membership";
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
  const browser = useRef<TelegramLinkBrowser | null>(null);
  const confirming = useRef<TelegramLinkBrowser | null>(null);
  const client = useQueryClient();
  const beginMutation = useMutation({
    mutationFn: beginTelegramLink,
  });
  const { reset: resetBegin } = beginMutation;
  const confirmMutation = useMutation({
    mutationFn: confirmTelegramLink,
  });
  const { reset: resetConfirm } = confirmMutation;
  const refreshMutation = useMutation({ mutationFn: onRefresh });
  const mutationResult = confirmMutation.data ?? beginMutation.data ?? null;
  const pending =
    beginMutation.isPending ||
    confirmMutation.isPending ||
    refreshMutation.isPending;

  const clearAutomaticConfirmation = useCallback(() => {
    automaticLinkRef.current = null;
    setAutomaticConfirmation(false);
  }, []);

  const refreshDetachedAccount = async (result: TelegramLinkMutationResult) => {
    // A settled server write can change the Account even after its initiating screen leaves.
    if (result.kind === "received") {
      await client.invalidateQueries({
        queryKey: accountPresentationQueryKey(),
      });
    }
  };

  const begin = async () => {
    const active = browser.current;
    if (active?.opening !== null) return;
    resetBegin();
    resetConfirm();
    clearAutomaticConfirmation();
    const telegramWindow = window.open("about:blank", "_blank");
    const opening = { popup: telegramWindow };
    active.opening = opening;
    if (telegramWindow !== null) telegramWindow.opener = null;
    try {
      const result = await beginMutation.mutateAsync();
      if (browser.current !== active) {
        await refreshDetachedAccount(result);
        return;
      }
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
    const active = browser.current;
    if (active === null || confirming.current !== null) return;
    confirming.current = active;
    resetBegin();
    resetConfirm();
    try {
      const result = await confirmMutation.mutateAsync(linkRef);
      if (browser.current !== active) {
        await refreshDetachedAccount(result);
        return;
      }
      if (result.kind === "received" && result.state.status !== "pending") {
        setDeepLink(null);
        clearTelegramLinkSession();
      }
      if (result.kind === "unauthorized") {
        setDeepLink(null);
        clearTelegramLinkSession();
      }
      await onRefresh();
      if (!automatic || browser.current !== active) return;
      if (result.kind !== "received" || result.state.status !== "pending") {
        clearAutomaticConfirmation();
      } else {
        setAutomaticConfirmation(false);
      }
    } catch {
      if (automatic && browser.current === active) clearAutomaticConfirmation();
    } finally {
      confirming.current = null;
    }
  };

  const confirm = (linkRef: string) => {
    if (confirming.current !== null) return;
    clearAutomaticConfirmation();
    void runConfirmation(linkRef, false);
  };
  const refresh = () => {
    resetBegin();
    resetConfirm();
    clearAutomaticConfirmation();
    refreshMutation.mutate();
  };

  const confirmOnReturn = useEffectEvent(() => {
    const linkRef = automaticLinkRef.current;
    if (
      linkRef === null ||
      document.visibilityState !== "visible" ||
      confirming.current !== null
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
      if (confirming.current === active) {
        clearAutomaticConfirmation();
        resetConfirm();
      }
    };
  }, [clearAutomaticConfirmation, resetBegin, resetConfirm]);

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
