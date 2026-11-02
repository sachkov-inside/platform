"use client";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
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
interface WaitlistView {
  readonly state: WaitlistState;
  readonly productSlug: string;
  readonly notice: string;
  readonly retryingWithdrawal: boolean;
}
interface WaitlistCommands {
  readonly begin: () => void;
  readonly withdraw: () => void;
  readonly finishLink: () => Promise<void>;
  readonly retry: () => void;
}
/**
 * Context несёт хранилище, которое не меняется, а не само значение. Новое значение context над
 * страницей заставило бы React гидрировать пришедшие потоком слоты с клиентским состоянием, и их
 * текст разошёлся бы с ответом сервера (#418, #1938). Слот гидрируется по серверному снимку и
 * обновляется после гидратации; команды всегда вызывают последнюю версию провайдера.
 */
interface WaitlistStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WaitlistView;
  readonly getServerSnapshot: () => WaitlistView;
  readonly publish: (view: WaitlistView, commands: WaitlistCommands) => void;
  readonly commands: WaitlistCommands;
}
function createWaitlistStore(
  initial: WaitlistView,
  initialCommands: WaitlistCommands,
): WaitlistStore {
  let current = initial;
  let latest = initialCommands;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => current,
    getServerSnapshot: () => initial,
    publish: (view, commands) => {
      latest = commands;
      if (
        view.state === current.state &&
        view.productSlug === current.productSlug &&
        view.notice === current.notice &&
        view.retryingWithdrawal === current.retryingWithdrawal
      )
        return;
      current = view;
      for (const listener of listeners) listener();
    },
    commands: {
      begin: () => {
        latest.begin();
      },
      withdraw: () => {
        latest.withdraw();
      },
      finishLink: () => latest.finishLink(),
      retry: () => {
        latest.retry();
      },
    },
  };
}
const Context = createContext<WaitlistStore | null>(null);
type Retry = "join" | "withdraw" | null;
/** Owns one mutation lifecycle for both course slots; the feature owns the Account-scoped fact. */
export function WaitlistProvider({
  productId,
  productSlug,
  children,
}: {
  readonly productId: string;
  readonly productSlug: string;
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
      const result = await beginWaitlistIntent(productId, source, productSlug);
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
  const view: WaitlistView = {
    state,
    productSlug,
    notice,
    retryingWithdrawal: retry === "withdraw",
  };
  const commands: WaitlistCommands = {
    begin: () => {
      if (retry === "withdraw") withdraw.mutate();
      else if (retry === "join") continuation.mutate();
      else begin.mutate();
    },
    withdraw: () => {
      withdraw.mutate();
    },
    finishLink,
    retry: () => {
      if (retry === "withdraw") withdraw.mutate();
      else if (retry === "join") continuation.mutate();
      else void query.refetch();
    },
  };
  const [store] = useState(() => createWaitlistStore(view, commands));
  useLayoutEffect(() => {
    store.publish(view, commands);
  });
  return <Context value={store}>{children}</Context>;
}
export function ProductWaitlistSlot({
  lower = false,
  existingOnly = false,
  programmeLabel,
}: {
  readonly lower?: boolean;
  readonly existingOnly?: boolean;
  readonly programmeLabel?: string;
}) {
  const store = useContext(Context);
  if (store === null) return null;
  return (
    <WaitlistSlotView
      existingOnly={existingOnly}
      lower={lower}
      programmeLabel={programmeLabel}
      store={store}
    />
  );
}
function WaitlistSlotView({
  store,
  lower,
  existingOnly,
  programmeLabel,
}: {
  readonly store: WaitlistStore;
  readonly lower: boolean;
  readonly existingOnly: boolean;
  readonly programmeLabel: string | undefined;
}) {
  const view = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const { commands } = store;
  if (existingOnly)
    return (
      <WaitlistMembership
        state={view.state}
        onBegin={commands.retry}
        onWithdraw={commands.withdraw}
        notice={view.notice}
        retryingWithdrawal={view.retryingWithdrawal}
        linking={<TelegramLinkAction onRefresh={commands.finishLink} />}
      />
    );
  return (
    <WaitlistAction
      lower={lower}
      {...(programmeLabel === undefined ? {} : { programmeLabel })}
      productSlug={view.productSlug}
      state={view.state}
      onBegin={commands.begin}
      onWithdraw={commands.withdraw}
      notice={view.notice}
      retryingWithdrawal={view.retryingWithdrawal}
      linking={<TelegramLinkAction onRefresh={commands.finishLink} />}
    />
  );
}
