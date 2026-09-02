"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { beginTelegramLink } from "../api/begin-telegram-link.browser";
import { confirmTelegramLink } from "../api/confirm-telegram-link.browser";

export function useTelegramLinkFlow(onRefresh: () => Promise<void>) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const beginMutation = useMutation({
    mutationFn: beginTelegramLink,
    onSuccess: async (result) => {
      if (result.kind === "received" && result.state.deepLink !== undefined) {
        setDeepLink(result.state.deepLink);
      }
      await onRefresh();
    },
  });
  const confirmMutation = useMutation({
    mutationFn: confirmTelegramLink,
    onSuccess: async (result) => {
      if (result.kind === "received" && result.state.status !== "pending") {
        setDeepLink(null);
      }
      await onRefresh();
    },
  });
  const refreshMutation = useMutation({ mutationFn: onRefresh });
  const mutationResult = confirmMutation.data ?? beginMutation.data ?? null;
  const pending =
    beginMutation.isPending ||
    confirmMutation.isPending ||
    refreshMutation.isPending;

  const begin = () => {
    beginMutation.reset();
    confirmMutation.reset();
    beginMutation.mutate();
  };
  const confirm = (linkRef: string) => {
    beginMutation.reset();
    confirmMutation.reset();
    confirmMutation.mutate(linkRef);
  };
  const refresh = () => {
    beginMutation.reset();
    confirmMutation.reset();
    refreshMutation.mutate();
  };

  return { begin, confirm, deepLink, mutationResult, pending, refresh };
}

export type TelegramLinkFlow = ReturnType<typeof useTelegramLinkFlow>;
