"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";

import { subscribeEnrollmentChange } from "@/entities/subscription";

/**
 * Перечитывает чтения под `queryKey`, когда любая поверхность этого браузера записала доступ к
 * продукту. Сброс присоединяется к уже начатому перечитыванию: объявление слышит и сама вкладка,
 * которая записала доступ. `queryKey` передаётся постоянным значением модуля.
 */
export function useAccessChangeRefresh(queryKey: QueryKey): void {
  const client = useQueryClient();
  useEffect(
    () =>
      subscribeEnrollmentChange(() => {
        void client.invalidateQueries({ queryKey }, { cancelRefetch: false });
      }),
    [client, queryKey],
  );
}
