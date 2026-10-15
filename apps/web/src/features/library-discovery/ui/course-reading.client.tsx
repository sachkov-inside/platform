"use client";

import { ArrowLeft, ArrowRight, ChevronRight, List, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { readerHistoryRestoreEvent } from "@/shared/lib/reader-history";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import type {
  CourseReadingContext,
  CourseReadingStep,
} from "../model/course-reading";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";
import styles from "./course-reading.module.css";

/** Shared course composition; routes retain ownership of body, access and mutations. */
export function CourseReadingLayout({
  context,
  children,
  supplementaryTitle,
}: {
  readonly supplementaryTitle?: string | undefined;
  readonly context: CourseReadingContext | null;
  readonly children: ReactNode;
}) {
  if (context === null)
    return <div className={styles["standalone"]}>{children}</div>;
  return (
    <div className={styles["layout"]} data-course-reading>
      <HidePublicFooter />
      <CourseRail context={context} />
      <div className={styles["document"]}>
        <ProgrammeDialog
          context={context}
          supplementary={supplementaryTitle !== undefined}
        />
        {children}
      </div>
    </div>
  );
}

export function CourseReadingHeader({
  context,
  title,
  metadata,
  actions,
  supplementary = false,
}: {
  readonly supplementary?: boolean;
  readonly context: CourseReadingContext;
  readonly title: string;
  readonly metadata: ReactNode;
  readonly actions?: ReactNode;
}) {
  const chapter = context.chapters.find(
    (entry) => entry.id === context.currentChapterId,
  );
  return (
    <header className={styles["header"]} data-reader-header>
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Breadcrumbs
            items={[
              { label: context.name, href: context.href },
              {
                label:
                  chapter?.ordinal === undefined
                    ? "Программа"
                    : `Глава ${String(chapter.ordinal)}`,
                fullLabel: chapter?.name,
                href: chapter?.href ?? context.href,
              },
              ...(supplementary
                ? [
                    {
                      label:
                        context.current.kind === "task" ? "Задание" : "Урок",
                      fullLabel: context.current.title,
                      href: context.current.href,
                      restoreOrigin: true,
                    },
                  ]
                : []),
              { label: title },
            ]}
          />
        </div>
        {actions == null ? null : (
          <nav
            aria-label="Действия материала"
            className={styles["actions"]}
            data-course-actions
          >
            {actions}
          </nav>
        )}
      </div>
      {supplementary ? null : (
        <p className={styles["position"]}>
          {chapter?.ordinal === undefined
            ? "Материалы"
            : `Глава ${String(chapter.ordinal)}`}
          <span aria-hidden="true">·</span>
          <span>
            Шаг{" "}
            {(chapter?.steps.findIndex(
              (step) => step.id === context.current.id,
            ) ?? -1) + 1}{" "}
            из {chapter?.steps.length ?? 0}
          </span>
        </p>
      )}
      <h1>{title}</h1>
      {metadata == null ? null : (
        <div className={styles["metadataRow"]}>
          <div className={styles["metadata"]}>{metadata}</div>
        </div>
      )}
    </header>
  );
}

export function CourseReadingFooter({
  context,
}: {
  readonly context: CourseReadingContext;
}) {
  return (
    <nav
      aria-label="Шаги курса"
      className={styles["footer"]}
      data-reader-footer
    >
      {(["previous", "next"] as const).map((direction) => {
        const step = context[direction];
        const Icon = direction === "previous" ? ArrowLeft : ArrowRight;
        return (
          <div key={direction} className={styles[direction]}>
            {step === null ? null : (
              <IntentPrefetchLink href={step.href}>
                <span>
                  {direction === "previous"
                    ? "Предыдущий шаг"
                    : "Следующий шаг"}
                  <Icon aria-hidden="true" size={16} />
                </span>
                <strong>{step.title}</strong>
              </IntentPrefetchLink>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function CourseRail({ context }: { readonly context: CourseReadingContext }) {
  // Next preserves this component between steps; a new server-selected step owns the selection.
  const selectionKey = `${context.current.id}:${context.currentChapterId}`;
  const [selection, setSelection] = useState({
    key: selectionKey,
    chapter: context.currentChapterId,
  });
  if (selection.key !== selectionKey) {
    setSelection({ key: selectionKey, chapter: context.currentChapterId });
  }
  const chapterId =
    selection.key === selectionKey
      ? selection.chapter
      : context.currentChapterId;
  const chapter = context.chapters.find((entry) => entry.id === chapterId);
  const currentStepIndex =
    chapter?.steps.findIndex((step) => step.id === context.current.id) ?? -1;
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const restore = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        typeof event.detail !== "string" ||
        !context.chapters.some((item) => item.id === event.detail)
      )
        return;
      setSelection({ key: selectionKey, chapter: event.detail });
    };
    window.addEventListener(readerHistoryRestoreEvent, restore);
    return () => {
      window.removeEventListener(readerHistoryRestoreEvent, restore);
    };
  }, [context.chapters, selectionKey]);
  useEffect(() => {
    const element = rail.current;
    const active = element?.querySelector<HTMLElement>('[aria-current="step"]');
    if (element === null || active === undefined || active === null) return;
    const railRect = element.getBoundingClientRect();
    const activeStepRect = active.getBoundingClientRect();
    if (activeStepRect.bottom > railRect.bottom)
      element.scrollTop += activeStepRect.bottom - railRect.bottom + 12;
    else if (activeStepRect.top < railRect.top)
      element.scrollTop -= railRect.top - activeStepRect.top + 12;
  }, [context.current.id, chapterId]);
  return (
    <aside
      className={styles["rail"]}
      aria-label="Текущая глава"
      data-course-chapter={chapterId}
    >
      <IntentPrefetchLink
        className={styles["programmeLink"]}
        href={context.href}
      >
        <List size={16} aria-hidden="true" />
        Вся программа
      </IntentPrefetchLink>
      <Select
        value={chapterId}
        onValueChange={(value) => {
          setSelection({ key: selectionKey, chapter: value });
        }}
      >
        <SelectTrigger
          aria-label="Глава курса"
          className={styles["chapterTrigger"]}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={styles["chapterMenu"]}>
          {context.chapters.map((entry) => (
            <SelectItem
              className={styles["chapterOption"]}
              value={entry.id}
              key={entry.id}
            >
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className={styles["railSteps"]} ref={rail} data-course-rail-scroll>
        {chapter?.steps.length === 0 ? (
          <p className={styles["empty"]}>Глава готовится</p>
        ) : (
          <ol>
            {chapter?.steps.map((step, index) => (
              <li
                key={step.id}
                data-course-position={
                  index < currentStepIndex
                    ? "before"
                    : index === currentStepIndex
                      ? "current"
                      : undefined
                }
              >
                <StepLink step={step} current={context.current.id} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function StepLink({
  step,
  current,
}: {
  readonly step: CourseReadingStep;
  readonly current: string;
}) {
  return (
    <IntentPrefetchLink
      className={styles["step"]}
      data-course-step={step.id}
      aria-current={step.id === current ? "step" : undefined}
      href={step.href}
    >
      <span aria-hidden="true" className={styles["mark"]} />
      <span>
        {step.kind === "task" ? <small>Задание</small> : null}
        {step.title}
      </span>
    </IntentPrefetchLink>
  );
}

function ProgrammeDialog({
  context,
  supplementary,
}: {
  readonly supplementary: boolean;
  readonly context: CourseReadingContext;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const desktop = window.matchMedia("(width >= 64rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) element?.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      element?.close();
    };
  }, [context.current.id]);
  const chapter = context.chapters.find(
    (entry) => entry.id === context.currentChapterId,
  );
  const chapterStep =
    (chapter?.steps.findIndex((step) => step.id === context.current.id) ?? -1) +
    1;
  function openProgramme() {
    dialog.current?.showModal();
    dialog.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest" });
  }
  return (
    <div className={styles["mobileProgramme"]}>
      <button
        type="button"
        className={styles["tabletTrigger"]}
        onClick={openProgramme}
        aria-haspopup="dialog"
        aria-label="Вся программа"
      >
        <List size={18} aria-hidden="true" /> Вся программа
      </button>
      <nav
        className={styles["dock"]}
        aria-label="Навигация по урокам"
        data-supplementary={supplementary ? "" : undefined}
      >
        {supplementary ? null : context.previous === null ? (
          <button disabled aria-label="Предыдущий шаг">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <IntentPrefetchLink
            aria-label="Предыдущий шаг"
            title={context.previous.title}
            href={context.previous.href}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </IntentPrefetchLink>
        )}
        <button
          type="button"
          className={styles["dockProgramme"]}
          onClick={openProgramme}
          aria-haspopup="dialog"
          aria-label="Вся программа"
        >
          <span>
            {supplementary ? (
              "Ваше место в курсе"
            ) : (
              <>
                Глава {chapter?.ordinal ?? 1} · Шаг {chapterStep} из{" "}
                {chapter?.steps.length ?? 0}
              </>
            )}
          </span>
          <strong>
            <List size={16} aria-hidden="true" /> Программа
          </strong>
        </button>
        {supplementary ? null : context.next === null ? (
          <button disabled aria-label="Следующий шаг">
            <ArrowRight size={20} />
          </button>
        ) : (
          <IntentPrefetchLink
            aria-label="Следующий шаг"
            title={context.next.title}
            href={context.next.href}
          >
            <ArrowRight size={20} aria-hidden="true" />
          </IntentPrefetchLink>
        )}
      </nav>
      <dialog
        className={styles["dialog"]}
        ref={dialog}
        aria-label={`Программа: ${context.name}`}
        closedby="any"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("a") !== null
          ) {
            event.currentTarget.close();
            return;
          }
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientY < rect.top ||
            event.clientY > rect.bottom ||
            event.clientX < rect.left ||
            event.clientX > rect.right
          )
            event.currentTarget.close();
        }}
      >
        <div className={styles["grabber"]} aria-hidden="true" />
        <div className={styles["dialogHead"]}>
          <h2>Программа</h2>
          <button
            type="button"
            aria-label="Закрыть программу"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Вся программа">
          {context.chapters.map((chapter) => (
            <details
              key={chapter.id}
              data-course-chapter-id={chapter.id}
              open={chapter.id === context.currentChapterId}
            >
              <summary>
                <span className={styles["chapterLabel"]}>
                  <span>Глава {chapter.ordinal ?? 1}</span>
                  <strong>{chapter.name}</strong>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </summary>
              <ol>
                {chapter.steps.map((step) => (
                  <li key={step.id}>
                    <StepLink step={step} current={context.current.id} />
                  </li>
                ))}
              </ol>
              {chapter.steps.length === 0 ? (
                <p className={styles["empty"]}>Глава готовится</p>
              ) : null}
            </details>
          ))}
        </nav>
      </dialog>
    </div>
  );
}
