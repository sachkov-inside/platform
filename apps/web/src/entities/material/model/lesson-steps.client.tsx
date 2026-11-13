"use client";
import type { RenderedBlock } from "@inside/material-blocks";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import {
  clampOpenedParts,
  lessonParts,
  type LessonParts,
} from "./lesson-parts";

/** Who speaks in the reply that replaces a pressed step button: the reader, or «Вы» for a guest. */
export interface LessonStepsReader {
  readonly name: string;
  readonly avatar: ReactNode;
}

/**
 * Where the opened parts live: on the server for a signed-in reader, in the browser for a guest.
 * `saved` is undefined until the store has answered; null means nothing past the first part.
 */
export interface LessonStepsProgress {
  readonly saved: number | null | undefined;
  readonly save: (openedParts: number) => void;
}

interface LessonStepsValue {
  readonly parts: LessonParts;
  /** Opened parts, clamped to the parts this version has. */
  readonly opened: number;
  /** «Показать урок целиком»: every part shows; the saved progress stays as it was. */
  readonly whole: boolean;
  readonly reader: LessonStepsReader;
  /** Opens every part up to and including `part` (counted from 0). */
  readonly openThrough: (part: number, focus?: "reply") => void;
  /** The first answer to an «after answer» exercise opens the text below it. */
  readonly answered: (exerciseId: string) => void;
  readonly setWhole: (whole: boolean) => void;
}

const LessonStepsContext = createContext<LessonStepsValue | null>(null);

/** Null outside a step-by-step Reader: the body then shows whole, as every other surface does. */
export function useLessonSteps(): LessonStepsValue | null {
  return useContext(LessonStepsContext);
}

/** A part that shows: opened, or the whole lesson is on. */
export function lessonPartShows(
  steps: LessonStepsValue | null,
  part: number,
): boolean {
  return steps === null || steps.whole || part < steps.opened;
}

/** Element that marks where a gate's part ends; the reply and the restore scroll land on it. */
export function lessonGateElementId(gate: number): string {
  return `lesson-step-${String(gate + 1)}`;
}

/**
 * Step-by-step reveal of one lesson (#2122). The server renders every part; the parts past the
 * opened ones are hidden by CSS only while scripts run, so search engines and readers without
 * scripts get the whole text. A lesson without gates passes its children through unchanged.
 */
export function LessonSteps({
  blocks,
  progress,
  reader,
  children,
}: {
  readonly blocks: readonly RenderedBlock[];
  readonly progress: LessonStepsProgress;
  readonly reader: LessonStepsReader;
  readonly children: ReactNode;
}) {
  const parts = useMemo(() => lessonParts(blocks), [blocks]);
  // The server and the first client render agree on the first part; the store answers later.
  const [opened, setOpened] = useState(1);
  const [whole, setWhole] = useState(false);
  const restored = useRef(false);
  // A part opened from an effect is in the document only after its render; then it scrolls.
  const pendingScroll = useRef<string | null>(null);
  const latest = useRef({ opened, progress, parts });
  useEffect(() => {
    latest.current = { opened, progress, parts };
  });

  const open = useCallback((count: number, sync: boolean): boolean => {
    const current = latest.current;
    const next = clampOpenedParts(count, current.parts.count);
    if (next <= current.opened) return false;
    latest.current = { ...current, opened: next };
    if (sync)
      flushSync(() => {
        setOpened(next);
      });
    else setOpened(next);
    current.progress.save(next);
    return true;
  }, []);

  const openThrough = useCallback(
    (part: number, focus?: "reply") => {
      if (!open(part + 1, focus === "reply")) return;
      if (focus !== "reply") return;
      const reply = document.getElementById(lessonGateElementId(part - 1));
      if (reply === null) return;
      reply.focus({ preventScroll: true });
      reply.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    },
    [open],
  );

  const answered = useCallback(
    (exerciseId: string) => {
      const gate = latest.current.parts.gates.findIndex(
        (item) => item.kind === "exercise" && item.exerciseId === exerciseId,
      );
      if (gate !== -1) open(gate + 2, false);
    },
    [open],
  );

  // The lesson opens where the reader stopped: every saved part, at the last one, unless the
  // address names a section of its own.
  useEffect(() => {
    if (restored.current || progress.saved === undefined) return;
    restored.current = true;
    const saved = clampOpenedParts(progress.saved, parts.count);
    if (saved <= latest.current.opened) return;
    latest.current = { ...latest.current, opened: saved };
    setOpened(saved);
    if (window.location.hash === "")
      pendingScroll.current = lessonGateElementId(saved - 2);
  }, [progress.saved, parts.count]);

  useEffect(() => {
    const id = pendingScroll.current;
    if (id === null) return;
    pendingScroll.current = null;
    document
      .getElementById(id)
      ?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [opened]);

  // A heading anchor, the course outline or an exercise's review link opens every part up to its
  // target. Opening happens before the browser and the body's own navigation look for the target.
  useEffect(() => {
    if (parts.count === 1) return;
    // Cuts stand in document order: the target's part is the last cut before it.
    const partOfTarget = (hash: string): number | undefined => {
      if (hash === "" || hash === "#") return undefined;
      const target = document.getElementById(safeDecode(hash.slice(1)));
      if (target === null) return undefined;
      let part = 0;
      for (const cut of document.querySelectorAll<HTMLElement>(
        "[data-lesson-part]",
      ))
        if (
          (cut.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0
        )
          part = Math.max(part, Number(cut.dataset["lessonPart"]));
      return part;
    };
    const reveal = (hash: string, sync: boolean): boolean => {
      const part = partOfTarget(hash);
      return part !== undefined && open(part + 1, sync);
    };
    const followLink = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (link === null) return;
      const target = new URL(link.href);
      const current = new URL(window.location.href);
      if (
        target.hash === "" ||
        target.origin !== current.origin ||
        target.pathname !== current.pathname
      )
        return;
      reveal(target.hash, true);
    };
    const followHash = () => {
      if (!reveal(window.location.hash, true)) return;
      document
        .getElementById(safeDecode(window.location.hash.slice(1)))
        ?.scrollIntoView({ block: "start", behavior: "instant" });
    };
    // The page opened at an anchor: its part renders first, then the body scrolls to it.
    if (reveal(window.location.hash, false))
      pendingScroll.current = safeDecode(window.location.hash.slice(1));
    document.addEventListener("click", followLink, true);
    window.addEventListener("hashchange", followHash);
    return () => {
      document.removeEventListener("click", followLink, true);
      window.removeEventListener("hashchange", followHash);
    };
  }, [open, parts.count]);

  const value = useMemo<LessonStepsValue>(
    () => ({
      parts,
      opened: clampOpenedParts(opened, parts.count),
      whole,
      reader,
      openThrough,
      answered,
      setWhole,
    }),
    [parts, opened, whole, reader, openThrough, answered],
  );
  if (parts.count === 1) return children;
  return <LessonStepsContext value={value}>{children}</LessonStepsContext>;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
