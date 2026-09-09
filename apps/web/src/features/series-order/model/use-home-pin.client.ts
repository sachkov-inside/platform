"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadHomePin, setHomePin } from "../api/home-pin.browser";
import type { HomePinControls, HomePinResult } from "./home-pin";

const homePinQueryKey = ["authoring-home-pin"] as const;

export function useHomePin() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: homePinQueryKey, queryFn: ({ signal }) => loadHomePin(signal), retry: false });
  const mutation = useMutation({ mutationFn: setHomePin, onSuccess: (result) => {
    if (result.kind === "ready") queryClient.setQueryData(homePinQueryKey, result);
    else void queryClient.invalidateQueries({ queryKey: homePinQueryKey });
  } });
  const pin = query.data?.kind === "ready" ? query.data.pin : null;
  const controls: HomePinControls = { pin, pending: mutation.isPending, onChange: (seriesId) => {
    if (pin !== null) mutation.mutate({ seriesId, expectedVersion: pin.version });
  } };
  const result = query.data?.kind === "ready" ? mutation.data ?? query.data : query.data;
  const error = query.isError || mutation.isError;
  return {
    controls,
    isPending: query.isPending,
    message: error ? "Не удалось проверить закреп. Обновите состояние и повторите действие." : query.isPending ? "Загружаем закреп…" : homePinMessage(result, mutation.data !== undefined),
    hasError: error || (result !== undefined && result.kind !== "ready"),
    retry: () => { mutation.reset(); void query.refetch(); },
  };
}

function homePinMessage(result: HomePinResult | undefined, saved: boolean): string {
  if (result?.kind === "ready") return saved ? result.pin.seriesId === null ? "Закреп снят с главной." : "Руководство закреплено на главной." : "Закрепите это руководство: оно появится первым на главной с изображением автора.";
  if (result?.kind === "conflict") return "Закреп изменился в другой вкладке. Состояние обновлено; закрепите руководство ещё раз.";
  if (result?.kind === "unauthorized") return "Сессия завершилась. Войдите снова.";
  if (result?.kind === "forbidden") return "Нет права управлять закрепом.";
  if (result?.kind === "invalid_input") return "Руководство недоступно или в нём нет опубликованных материалов. Обновите состав и повторите действие.";
  return "Закреп временно недоступен. Обновите состояние и повторите действие.";
}
