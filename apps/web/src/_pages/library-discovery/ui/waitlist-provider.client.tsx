"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TelegramLinkAction } from "@/features/account-access";
import {
  WaitlistAction,
  type WaitlistState,
} from "@/features/product-waitlist";
import {
  beginWaitlistIntent,
  joinWaitlist,
  readWaitlist,
  withdrawWaitlist,
} from "../api/product-waitlist.browser";
const Context = createContext<{
  state: WaitlistState;
  begin: () => void;
  withdraw: () => void;
  finishLink: () => Promise<void>;
  notice: string;
} | null>(null);
const syncKey = "inside.product-waitlist.changed";
/** Owns one query and one mutation lifecycle for both accepted course slots. No optimistic success. */
export function WaitlistProvider({
  productId,
  children,
}: {
  readonly productId: string;
  readonly children: ReactNode;
}) {
  const client = useQueryClient();
  const key = ["product-waitlist", productId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => readWaitlist(productId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const [phase, setPhase] = useState<WaitlistState | null>(null);
  const [notice, setNotice] = useState("");
  const continued = useRef(false);
  function notify() {
    try {
      localStorage.setItem(syncKey, crypto.randomUUID());
    } catch {
      /* Storage is optional; focus still revalidates the server-owned state. */
    }
  }
  function apply(result: Awaited<ReturnType<typeof joinWaitlist>>) {
    if (result.kind === "saved") {
      client.setQueryData(key, {
        kind: "ready",
        intakeId: result.intakeId,
        name: result.name,
        active: result.active,
        continuation: false,
      });
      setPhase(null);
      setNotice(
        result.active
          ? "Вы в списке."
          : "Вы отказались от ожидания. Можно записаться снова.",
      );
      notify();
      void client.invalidateQueries({ queryKey: key });
    } else if (result.kind === "telegram-required") setPhase("linking");
    else if (result.kind === "expired") setPhase("expired");
    else setPhase("error");
  }
  const continuation = useMutation({
    mutationFn: () => joinWaitlist(productId),
    onMutate: () => {
      setPhase("saving");
    },
    onSuccess: apply,
    onError: () => {
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
        input.value = "/products/ai-engineering";
        form.append(input);
        document.body.append(form);
        form.submit();
        return null;
      }
      return result.kind === "continue"
        ? await joinWaitlist(productId)
        : result;
    },
    onMutate: () => {
      setNotice("");
      setPhase("saving");
    },
    onSuccess: (result) => {
      if (result !== null) apply(result);
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
    onSuccess: apply,
    onError: () => {
      setPhase("error");
    },
  });
  const finishLink = async () => {
    apply(await joinWaitlist(productId));
  };
  const continueIntent = continuation.mutate;
  useEffect(() => {
    if (
      query.data?.kind === "ready" &&
      query.data.continuation &&
      !continued.current
    ) {
      continued.current = true;
      continueIntent();
    }
  }, [query.data, continueIntent]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === syncKey) {
        setPhase(null);
        void client.invalidateQueries({
          queryKey: ["product-waitlist", productId],
        });
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener("storage", changed);
    };
  }, [client, productId]);
  const state: WaitlistState =
    phase ??
    (query.isPending
      ? "loading"
      : query.data?.kind === "unavailable" || query.isError
        ? "error"
        : query.data.kind === "ready" && query.data.active
          ? "success"
          : "idle");
  return (
    <Context
      value={{
        state,
        begin: () => {
          begin.mutate();
        },
        withdraw: () => {
          withdraw.mutate();
        },
        finishLink,
        notice,
      }}
    >
      {children}
    </Context>
  );
}
export function ProductWaitlistSlot({
  lower = false,
}: {
  readonly lower?: boolean;
}) {
  const context = useContext(Context);
  if (context === null) return null;
  return (
    <WaitlistAction
      lower={lower}
      state={context.state}
      onBegin={context.begin}
      onWithdraw={context.withdraw}
      notice={context.notice}
      linking={<TelegramLinkAction onRefresh={context.finishLink} />}
    />
  );
}
