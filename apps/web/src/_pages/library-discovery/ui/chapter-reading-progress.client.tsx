"use client";

import { useEffect, useMemo } from "react";
import { useMaterialReading } from "@/entities/material";

/**
 * Uses the same account-scoped saved marks as the lesson rows, including rows not yet revealed.
 * `sentence` is the line of a finished roadmap chapter: «Изучено 9 из 13» (#2141).
 */
export function ChapterReadingProgress({
  materialIds,
  name,
  sentence = false,
}: {
  readonly materialIds: readonly string[];
  readonly name: string;
  readonly sentence?: boolean;
}) {
  const { accountId, states, register, resolved, failed } =
    useMaterialReading();
  const ids = useMemo(() => [...new Set(materialIds)], [materialIds]);
  useEffect(() => {
    const unregister = ids.map(register);
    return () => {
      for (const release of unregister) release();
    };
  }, [ids, register]);
  if (ids.length === 0)
    return sentence ? null : (
      <span className="programme-chapter-progress" aria-hidden="true" />
    );
  const missing =
    accountId !== null && (!resolved || ids.some((id) => !states.has(id)));
  const read =
    accountId === null
      ? 0
      : ids.filter((id) => states.get(id)?.isRead === true).length;
  const label = failed && missing ? "—" : missing ? "…" : String(read);
  return (
    <span
      className={sentence ? undefined : "programme-chapter-progress"}
      data-chapter-progress
      aria-label={
        missing
          ? `Прогресс главы «${name}» ${failed ? "недоступен" : "загружается"}`
          : `Изучено ${String(read)} из ${String(ids.length)} материалов главы «${name}»`
      }
    >
      {sentence ? "Изучено " : null}
      {label} из {ids.length}
    </span>
  );
}
