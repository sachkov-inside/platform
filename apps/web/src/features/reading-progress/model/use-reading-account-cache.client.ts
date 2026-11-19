"use client";
import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { clearOtherReadingAccounts } from "./reading-cache";

/** The signed-out reader stops exposing private state before the form leaves this document. */
export function useReadingAccountCache(
  queryClient: QueryClient,
  accountId: string | null,
  resolved: boolean,
) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (resolved) clearOtherReadingAccounts(queryClient, accountId);
  }, [accountId, queryClient, resolved]);
  useEffect(() => {
    const clear = (event: Event) => {
      const form = event.target;
      if (
        form instanceof HTMLFormElement &&
        new URL(form.action).pathname === "/auth/sign-out"
      ) {
        setSignedOut(true);
        clearOtherReadingAccounts(queryClient, null);
      }
    };
    document.addEventListener("submit", clear, true);
    return () => {
      document.removeEventListener("submit", clear, true);
    };
  }, [queryClient]);
  return signedOut ? null : accountId;
}
