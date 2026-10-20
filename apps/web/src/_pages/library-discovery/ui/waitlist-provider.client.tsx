"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TelegramLinkAction } from "@/features/account-access";
import {
  WaitlistAction,
  WaitlistMembership,
  type WaitlistState,
  useProductWaitlist,
  productWaitlistKey,
  productWaitlistChanges,
  refreshProductWaitlist,
  beginWaitlistIntent,
  joinWaitlist,
  withdrawWaitlist,
} from "@/features/product-waitlist";
const Context = createContext<{
  state: WaitlistState;
  begin: () => void;
  withdraw: () => void;
  finishLink: () => Promise<void>;
  notice: string;
  retryingWithdrawal: boolean;
  retry: () => void;
} | null>(null);
type Retry = "join" | "withdraw" | null;
/** Owns one mutation lifecycle for both course slots; the feature owns the Account-scoped fact. */
export function WaitlistProvider({
  productId,
  children,
}: {
  readonly productId: string;
  readonly children: ReactNode;
}) {
  const client = useQueryClient();
  const { query, accountId, resolved } = useProductWaitlist(productId);
  const key = productWaitlistKey(accountId, productId);
  const [phase, setPhase] = useState<WaitlistState | null>(null);
  const [retry, setRetry] = useState<Retry>(null);
  const [notice, setNotice] = useState("");
  const continued = useRef(false);
  function clearReturnMarker() {
    const url = new URL(window.location.href);
    if (url.searchParams.has("waitlist")) {
      url.searchParams.delete("waitlist");
      window.history.replaceState(null, "", url);
    }
  }
  async function apply(
    result: Awaited<ReturnType<typeof joinWaitlist>>,
    operation: Exclude<Retry, null>,
  ) {
    if (result.kind === "saved" && accountId !== null) {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, {
        kind: "ready",
        intakeId: result.intakeId,
        name: result.name,
        active: result.active,
        accountId,
        continuation: false,
      });
      setPhase(null);
      setRetry(null);
      clearReturnMarker();
      setNotice(
        result.active
          ? "Вы в списке ожидания."
          : operation === "withdraw"
            ? "Вы отказались от ожидания."
            : "Запись в список ожидания не требуется: курс уже доступен.",
      );
      await refreshProductWaitlist(
        client,
        accountId,
        productId,
        productWaitlistChanges(accountId, productId).announce(),
      );
    } else if (result.kind === "telegram-required") {
      setRetry("join");
      setPhase("linking");
    } else if (result.kind === "expired") {
      setRetry(null);
      setPhase("expired");
      clearReturnMarker();
    } else {
      setRetry(operation);
      setPhase("error");
    }
  }
  const continuation = useMutation({
    mutationFn: () => joinWaitlist(productId),
    onMutate: () => {
      setPhase("saving");
    },
    onSuccess: (result) => apply(result, "join"),
    onError: () => {
      setRetry("join");
      setPhase("error");
    },
  });
  const begin = useMutation({
    mutationFn: async () => {
      const source =
        new URL(window.location.href).searchParams.get("utm_source") ??
        new URL(window.location.href).searchParams.get("source");
      const result = await beginWaitlistIntent(productId, source);
      if (result.kind === "sign-in") {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/auth/sign-in";
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "returnTo";
        input.value = result.returnTo;
        form.append(input);
        document.body.append(form);
        form.submit();
        return null;
      }
      if (result.kind !== "continue") return result;
      setRetry("join");
      return await joinWaitlist(productId);
    },
    onMutate: () => {
      setNotice("");
      setPhase("saving");
    },
    onSuccess: async (result) => {
      if (result !== null) await apply(result, "join");
    },
    onError: () => {
      setPhase("error");
    },
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawWaitlist(productId),
    onMutate: () => {
      setPhase("saving");
    },
    onSuccess: (result) => apply(result, "withdraw"),
    onError: () => {
      setRetry("withdraw");
      setPhase("error");
    },
  });
  const finishLink = async () => {
    await apply(await joinWaitlist(productId), "join");
  };
  const continueIntent = continuation.mutate;
  useEffect(() => {
    if (
      query.data?.kind === "ready" &&
      query.data.continuation &&
      phase !== "linking" &&
      !continued.current
    ) {
      continued.current = true;
      continueIntent();
    }
  }, [query.data, continueIntent, phase]);
  const state: WaitlistState =
    phase ??
    (!resolved
      ? "loading"
      : accountId === null
        ? "idle"
        : query.isPending
          ? "loading"
          : query.isError || query.data.kind === "unavailable"
            ? "error"
            : query.data.kind === "ready" && query.data.active
              ? "success"
              : "idle");
  return (
    <Context
      value={{
        state,
        begin: () => {
          if (retry === "withdraw") withdraw.mutate();
          else if (retry === "join") continuation.mutate();
          else begin.mutate();
        },
        withdraw: () => {
          withdraw.mutate();
        },
        finishLink,
        notice,
        retryingWithdrawal: retry === "withdraw",
        retry: () => {
          if (retry === "withdraw") withdraw.mutate();
          else if (retry === "join") continuation.mutate();
          else void query.refetch();
        },
      }}
    >
      {children}
    </Context>
  );
}
export function ProductWaitlistSlot({
  lower = false,
  existingOnly = false,
}: {
  readonly lower?: boolean;
  readonly existingOnly?: boolean;
}) {
  const context = useContext(Context);
  if (context === null) return null;
  if (existingOnly)
    return (
      <WaitlistMembership
        state={context.state}
        onBegin={context.retry}
        onWithdraw={context.withdraw}
        notice={context.notice}
        retryingWithdrawal={context.retryingWithdrawal}
        linking={<TelegramLinkAction onRefresh={context.finishLink} />}
      />
    );
  return (
    <WaitlistAction
      lower={lower}
      state={context.state}
      onBegin={context.begin}
      onWithdraw={context.withdraw}
      notice={context.notice}
      retryingWithdrawal={context.retryingWithdrawal}
      linking={<TelegramLinkAction onRefresh={context.finishLink} />}
    />
  );
}
