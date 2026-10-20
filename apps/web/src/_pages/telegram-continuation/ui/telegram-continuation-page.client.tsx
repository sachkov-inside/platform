"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  AccountTelegramPanel,
  useAccountPresentation,
} from "@/features/account-access";
import { Button } from "@/shared/ui/button";
import { selfRefreshingRead } from "@/shared/api/self-refreshing-query";
import { internalRoute } from "@/shared/routing/internal-route";
import { requestTelegramContinuation } from "../api/telegram-continuation.browser";
import { telegramContinuationPath } from "../model/telegram-continuation";

/** The URL carries Product intent; the browser's own session authorizes every read and link. */
export function TelegramContinuationPage({
  attemptId,
  product,
}: {
  readonly attemptId: string;
  readonly product?: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
}) {
  const router = useRouter();
  const account = useAccountPresentation();
  const query = useQuery({
    ...selfRefreshingRead,
    queryKey: ["telegram-activation", attemptId],
    gcTime: 0,
    queryFn: ({ signal }) => requestTelegramContinuation(attemptId, signal),
    refetchInterval: (current) =>
      current.state.data?.state === "pending" ||
      current.state.data?.state === "link_required"
        ? 1000
        : false,
    refetchOnWindowFocus: true,
  });
  const state = query.data;
  useEffect(() => {
    if (state?.state === "active")
      router.replace(
        internalRoute(
          `/products/${encodeURIComponent(state.product.slug)}/programme`,
        ),
      );
  }, [state, router]);
  const presentation =
    account.data?.kind === "ready" ? account.data.presentation : null;
  const unauthorized =
    state?.state === "unauthorized" || account.data?.kind === "unauthorized";
  const returnTo = telegramContinuationPath(attemptId);

  return (
    <div className="mx-auto w-full max-w-xl px-5 py-12 sm:py-20">
      <h1 className="text-balance text-3xl font-bold">
        {state !== undefined && "product" in state
          ? state.product.name
          : (product?.name ?? "Получить доступ к курсу")}
      </h1>
      {unauthorized ? (
        <div className="mt-6 space-y-4">
          <p>
            {product === undefined
              ? "Войдите, чтобы получить доступ к курсу."
              : `Войдите, чтобы получить доступ к ${product.name}.`}
          </p>
          <p className="text-sm text-muted-foreground">
            Уже есть аккаунт с почтой? Войдите в него, чтобы сохранить покупки и
            прогресс. Новый аккаунт можно создать через Telegram.
          </p>
          <form action="/auth/sign-in" method="post">
            <input name="returnTo" type="hidden" value={returnTo} />
            <Button type="submit">Войти через Telegram или почту</Button>
          </form>
          <p className="text-sm text-muted-foreground">
            Вход действует в этом браузере. После входа мы вернём вас к
            выбранному курсу.
          </p>
        </div>
      ) : state?.state === "identity_conflict" ? (
        <div className="mt-6 space-y-4" role="alert">
          <p>
            Этот Telegram связан с другим аккаунтом. Войдите в связанный аккаунт
            или обратитесь за помощью в боте.
          </p>
          <form action="/auth/sign-out" method="post">
            <input name="returnTo" type="hidden" value={returnTo} />
            <Button type="submit" variant="outline">
              Выйти из аккаунта
            </Button>
          </form>
        </div>
      ) : state?.state === "expired" ? (
        <p className="mt-6" role="alert">
          Ссылка больше не действует. Откройте ссылку получения доступа в боте
          ещё раз.
        </p>
      ) : query.isError ||
        state?.state === "unavailable" ||
        state?.state === "identity_unavailable" ||
        state?.state === "dependency_unavailable" ? (
        <div className="mt-6 space-y-4" role="alert">
          <p>Не удалось проверить доступ. Попробуйте ещё раз.</p>
          <Button
            onClick={() => {
              void query.refetch();
            }}
            type="button"
          >
            Повторить проверку
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <p role="status">
            {state?.state === "active"
              ? "Курс доступен. Открываем программу…"
              : state?.state === "pending"
                ? "Проверяем доступ к выбранному курсу…"
                : state?.state === "link_required"
                  ? "Подключите Telegram, которым пользуетесь в группе курса."
                  : "Проверяем состояние аккаунта…"}
          </p>
          {state?.state === "link_required" &&
          presentation?.telegramMembership.link.kind === "retryable" &&
          presentation.telegramMembership.link.reason === "expired" ? (
            <p role="alert">
              Время подтверждения истекло. Начните вход ещё раз.
            </p>
          ) : null}
          {state?.state === "link_required" && presentation !== null ? (
            <AccountTelegramPanel
              retryLabel="Продолжить на платформе"
              link={presentation.telegramMembership.link}
              onRefresh={async () => {
                await Promise.all([account.refetch(), query.refetch()]);
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
