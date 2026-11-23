"use client";

import { useCallback, useMemo } from "react";
import { useMaterialReading } from "@/entities/material";

export interface ChapterReading {
  /** Registers the chapter's materials with the saved-marks store while the node is mounted. */
  readonly connect: (node: HTMLElement | null) => (() => void) | undefined;
  readonly failed: boolean;
  /** The marks of a signed-in reader are still loading or could not be read. */
  readonly missing: boolean;
  /** Studied materials; a guest has studied none. */
  readonly read: number;
  readonly total: number;
}

/** The saved marks of one chapter, the same account-scoped marks the lesson rows read. */
export function useChapterReading(
  materialIds: readonly string[],
): ChapterReading {
  const { accountId, states, register, resolved, failed } =
    useMaterialReading();
  const ids = useMemo(() => [...new Set(materialIds)], [materialIds]);
  const connect = useCallback(
    (node: HTMLElement | null) => {
      if (node === null) return;
      const unregister = ids.map(register);
      return () => {
        for (const release of unregister) release();
      };
    },
    [ids, register],
  );
  const missing =
    accountId !== null && (!resolved || ids.some((id) => !states.has(id)));
  const read =
    accountId === null
      ? 0
      : ids.filter((id) => states.get(id)?.isRead === true).length;
  return { connect, failed, missing, read, total: ids.length };
}

/**
 * Uses the same account-scoped saved marks as the lesson rows, including rows not yet revealed.
 * `sentence` is the line of a chapter window: «Изучено 9 из 13».
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
  const { connect, failed, missing, read, total } =
    useChapterReading(materialIds);
  if (total === 0)
    return sentence ? null : (
      <span className="programme-chapter-progress" aria-hidden="true" />
    );
  const label = failed && missing ? "—" : missing ? "…" : String(read);
  return (
    <span
      ref={connect}
      className={sentence ? undefined : "programme-chapter-progress"}
      data-chapter-progress
      aria-label={
        missing
          ? `Прогресс главы «${name}» ${failed ? "недоступен" : "загружается"}`
          : `Изучено ${String(read)} из ${String(total)} материалов главы «${name}»`
      }
    >
      {sentence ? "Изучено " : null}
      {label} из {total}
    </span>
  );
}
