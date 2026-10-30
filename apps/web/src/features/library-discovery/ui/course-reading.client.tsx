"use client";

import { usePathname } from "next/navigation";
import { parseReaderCourseAnchor } from "@/shared/routing/reader-course-anchor";
import { CourseReferenceNavigation } from "./course-reference-navigation.client";
import {
  CourseNavigationBar,
  CourseNavigationItem,
} from "./course-navigation-bar.client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  List,
  X,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { readerHistoryRestoreEvent } from "@/shared/lib/reader-history";
import { subscribeShellBreakpoint } from "@/shared/lib/shell-scroll";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { useMaterialReading } from "@/entities/material";
import {
  isProgrammeStepOpenedForReference,
  type CourseReadingContext,
  type CourseReadingStep,
} from "../model/course-reading";
import {
  courseChapterProgress,
  courseStepProgress,
  type CourseReadMarks,
  type CourseStepProgress,
} from "../model/course-step-progress";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";
import styles from "./course-reading.module.css";
import { CourseReadingHostContext } from "./course-reading-host-context.client";

interface TaskSubmissionOverlay {
  readonly courseHref: string;
  readonly submittedTaskIds: readonly string[];
}
const TaskSubmissionStatusContext = createContext<Dispatch<
  SetStateAction<TaskSubmissionOverlay | null>
> | null>(null);

/** An uncached server island supplies private status without delaying the public body. */
export function CourseTaskSubmissionStatuses({
  courseHref,
  submittedTaskIds,
}: TaskSubmissionOverlay) {
  const update = useContext(TaskSubmissionStatusContext);
  useEffect(() => {
    update?.({ courseHref, submittedTaskIds });
    return () => update?.(null);
  }, [courseHref, submittedTaskIds, update]);
  return null;
}

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
  const [submissionOverlay, setSubmissionOverlay] =
    useState<TaskSubmissionOverlay | null>(null);
  const host = useContext(CourseReadingHostContext);
  const publish = host?.publish;
  const content = useRef<HTMLDivElement>(null);
  const displayedContext = useMemo(() => {
    if (context === null) return context;
    const overlay =
      submissionOverlay?.courseHref === context.courseHref
        ? submissionOverlay
        : null;
    if (overlay === null && context.taskStatusesDeferred !== true)
      return context;
    return {
      ...context,
      chapters: context.chapters.map((chapter) => ({
        ...chapter,
        steps: chapter.steps.map((step) => {
          if (step.kind !== "task" && step.practiceTaskCode === undefined)
            return step;
          // Without the private statuses a submission is unknown, not absent.
          const { taskSubmitted: _guest, ...rest } = step;
          return overlay === null
            ? rest
            : {
                ...rest,
                taskSubmitted: overlay.submittedTaskIds.includes(
                  step.practiceTaskCode === undefined
                    ? step.id
                    : `task:${step.practiceTaskCode}`,
                ),
              };
        }),
      })),
    };
  }, [context, submissionOverlay]);
  useLayoutEffect(() => {
    if (
      content.current === null ||
      content.current.getClientRects().length === 0
    )
      return;
    publish?.({
      context: displayedContext,
      supplementaryTitle,
      pathname: window.location.pathname,
    });
  }, [displayedContext, publish, supplementaryTitle]);
  if (displayedContext === null)
    return (
      <div ref={content} className={styles["standalone"]}>
        {children}
      </div>
    );
  return (
    <TaskSubmissionStatusContext.Provider value={setSubmissionOverlay}>
      <div
        className={styles["layout"]}
        data-course-reading={host?.active === true ? undefined : ""}
        data-course-local-frame
      >
        <HidePublicFooter />
        {host?.active === true ? null : (
          <CourseRail context={displayedContext} />
        )}
        <div className={styles["document"]}>
          {host?.active === true ? null : (
            <ProgrammeDialog
              context={displayedContext}
              supplementary={supplementaryTitle !== undefined}
            />
          )}
          <div
            ref={content}
            className={styles["content"]}
            data-course-step-content
          >
            {children}
          </div>
        </div>
      </div>
    </TaskSubmissionStatusContext.Provider>
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
            compact
            items={[
              { label: context.name, href: context.href },
              ...(supplementary &&
              context.currentPosition === 0 &&
              !isProgrammeStepOpenedForReference(context)
                ? [{ label: "Дополнительный материал" }]
                : [
                    {
                      label:
                        chapter?.ordinal === undefined
                          ? "Программа"
                          : `Глава ${String(chapter.ordinal)}`,
                      fullLabel: chapter?.name,
                      href: chapter?.href ?? context.href,
                    },
                  ]),
              ...(supplementary && context.current.kind === "task"
                ? [
                    {
                      label: "Задание",
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

export function CourseRail({
  context,
  variant = "rail",
}: {
  readonly context: CourseReadingContext;
  /** The sheet repeats the rail inside the programme dialog without owning saved rail history. */
  readonly variant?: "rail" | "sheet";
}) {
  // Next preserves this component between steps; a new server-selected step owns the selection.
  const selectionKey = `${context.current.id}:${context.currentChapterId}`;
  const [selection, setSelection] = useState({
    key: selectionKey,
    chapter: context.currentChapterId,
    choosing: false,
  });
  if (selection.key !== selectionKey) {
    setSelection({
      key: selectionKey,
      chapter: context.currentChapterId,
      choosing: false,
    });
  }
  const chapterId =
    selection.key === selectionKey
      ? selection.chapter
      : context.currentChapterId;
  const choosing = selection.key === selectionKey && selection.choosing;
  const chapterIndex = context.chapters.findIndex(
    (entry) => entry.id === chapterId,
  );
  const chapter = context.chapters[chapterIndex];
  const readingChapterIndex = context.chapters.findIndex(
    (entry) => entry.id === context.currentChapterId,
  );
  const readingChapter = context.chapters[readingChapterIndex];
  const marks = useCourseReadMarks(context);
  const chapterProgress =
    chapter === undefined ? null : courseChapterProgress(chapter.steps, marks);
  const courseProgress = courseChapterProgress(
    context.chapters.flatMap((entry) => entry.steps),
    marks,
  );
  const chapterListId = useId();
  const chapterToggle = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const restore = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        typeof event.detail !== "string" ||
        !context.chapters.some((item) => item.id === event.detail)
      )
        return;
      setSelection({
        key: selectionKey,
        chapter: event.detail,
        choosing: false,
      });
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
    // A hidden current step comes to the middle, so the steps around it stay in view.
    if (
      activeStepRect.bottom > railRect.bottom ||
      activeStepRect.top < railRect.top
    )
      element.scrollTop +=
        (activeStepRect.top + activeStepRect.bottom) / 2 -
        (railRect.top + railRect.bottom) / 2;
  }, [context.current.id, chapterId, choosing]);
  function chooseChapter(id: string) {
    setSelection({ key: selectionKey, chapter: id, choosing: false });
    chapterToggle.current?.focus();
  }
  const Root = variant === "rail" ? "aside" : "div";
  return (
    <Root
      className={styles[variant === "rail" ? "rail" : "sheetRail"]}
      {...(variant === "rail"
        ? { "aria-label": "Текущая глава", "data-course-chapter": chapterId }
        : {})}
      onKeyDown={(event) => {
        if (!choosing || event.key !== "Escape") return;
        event.preventDefault();
        // The dialog would otherwise close on the same Escape that only leaves the chapter list.
        event.stopPropagation();
        chooseChapter(chapterId);
      }}
    >
      {variant === "rail" ? (
        <IntentPrefetchLink
          className={styles["programmeLink"]}
          href={context.courseHref}
        >
          <BookOpen size={16} aria-hidden="true" />
          Страница курса
        </IntentPrefetchLink>
      ) : null}
      <button
        ref={chapterToggle}
        type="button"
        className={styles["chapterToggle"]}
        aria-expanded={choosing}
        aria-controls={chapterListId}
        onClick={() => {
          setSelection({
            key: selectionKey,
            chapter: chapterId,
            choosing: !choosing,
          });
        }}
      >
        {choosing ? (
          <span className={styles["chapterHeading"]}>
            <span className={styles["chapterOrdinal"]}>
              {formatChapterCount(context.chapters.length)}
              {courseProgress === null
                ? null
                : ` · ${String(courseProgress.done)} из ${String(courseProgress.total)} пройдено`}
            </span>
            <span className={styles["chapterName"]}>Выберите главу</span>
          </span>
        ) : (
          <span className={styles["chapterHeading"]}>
            <span className={styles["chapterOrdinal"]}>
              Глава {chapter?.ordinal ?? chapterIndex + 1} из{" "}
              {context.chapters.length}
            </span>
            <span className={styles["chapterName"]}>{chapter?.name}</span>
          </span>
        )}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {!choosing && chapterProgress !== null ? (
        <p className={styles["chapterProgress"]} data-course-chapter-progress>
          <span aria-hidden="true" className={styles["progressTrack"]}>
            <span
              style={{
                inlineSize: `${String((chapterProgress.done / chapterProgress.total) * 100)}%`,
              }}
            />
          </span>
          {chapterProgress.done} из {chapterProgress.total} пройдено
        </p>
      ) : (
        <div aria-hidden="true" className={styles["chapterDivider"]} />
      )}
      {!choosing &&
      readingChapter !== undefined &&
      chapterId !== context.currentChapterId ? (
        <p className={styles["browsing"]}>
          <span>
            Вы читаете главу {readingChapter.ordinal ?? readingChapterIndex + 1}
          </span>
          <button
            type="button"
            onClick={() => {
              chooseChapter(context.currentChapterId);
            }}
          >
            К текущему шагу
          </button>
        </p>
      ) : null}
      {choosing ? (
        <nav
          id={chapterListId}
          className={styles["railSteps"]}
          aria-label="Главы курса"
        >
          <ol className={styles["chapterChoices"]}>
            {context.chapters.map((entry, index) => {
              const progress = courseChapterProgress(entry.steps, marks);
              const complete =
                progress !== null && progress.done === progress.total;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={styles["chapterChoice"]}
                    data-course-chapter-choice={entry.id}
                    data-reading={
                      index === readingChapterIndex ? true : undefined
                    }
                    aria-current={entry.id === chapterId ? "true" : undefined}
                    onClick={() => {
                      chooseChapter(entry.id);
                    }}
                  >
                    <span className={styles["chapterNumber"]}>
                      <span className="sr-only">Глава </span>
                      {entry.ordinal ?? index + 1}
                    </span>{" "}
                    <span className={styles["chapterChoiceName"]}>
                      {entry.name}
                    </span>
                    {index === readingChapterIndex ? (
                      <span className="sr-only">, вы здесь</span>
                    ) : null}
                    {progress === null ? null : (
                      <span
                        className={styles["chapterCount"]}
                        data-complete={complete ? true : undefined}
                      >
                        {complete ? (
                          <Check size={12} strokeWidth={3} aria-hidden="true" />
                        ) : null}
                        <span aria-hidden="true">
                          {progress.done}/{progress.total}
                        </span>
                        <span className="sr-only">
                          , пройдено {progress.done} из {progress.total}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : (
        <div
          className={styles["railSteps"]}
          ref={rail}
          data-course-rail-scroll={variant === "rail" ? true : undefined}
          role="navigation"
          aria-label="Шаги текущей главы"
          tabIndex={variant === "rail" ? 0 : undefined}
        >
          {chapter?.steps.length === 0 ? (
            <p className={styles["empty"]}>Глава готовится</p>
          ) : (
            <ol className={styles["stepList"]}>
              {chapter?.steps.map((step) => (
                <li key={step.id}>
                  <StepLink
                    step={step}
                    current={context.current.id}
                    progress={courseStepProgress(step, marks)}
                  />
                </li>
              ))}
            </ol>
          )}
          <CourseReferenceNavigation
            key={chapter?.id}
            references={[
              ...(chapter?.references ?? []),
              ...(context.references ?? []).filter(
                (reference) =>
                  reference.id === context.activeReferenceId &&
                  chapter?.references?.some(
                    (item) => item.id === reference.id,
                  ) !== true,
              ),
            ]}
            activeReferenceId={context.activeReferenceId}
            courseHref={context.href}
            anchor={
              context.currentPosition > 0
                ? parseReaderCourseAnchor(context.current.id)
                : undefined
            }
          />
        </div>
      )}
    </Root>
  );
}

/** Joins the Account's batched reading marks; a guest or an unresolved Account shows no progress. */
function useCourseReadMarks(context: CourseReadingContext): CourseReadMarks {
  const { accountId, resolved, states, register } = useMaterialReading();
  const ids = useMemo(
    () => [
      ...new Set(
        context.chapters.flatMap((chapter) =>
          chapter.steps.flatMap((step) =>
            step.materialId === undefined ? [] : [step.materialId],
          ),
        ),
      ),
    ],
    [context.chapters],
  );
  useEffect(() => {
    const releases = ids.map(register);
    return () => {
      for (const release of releases) release();
    };
  }, [ids, register]);
  return resolved && accountId !== null ? states : null;
}

function formatChapterCount(count: number) {
  const tens = count % 100;
  const units = count % 10;
  const word =
    tens >= 11 && tens <= 14
      ? "глав"
      : units === 1
        ? "глава"
        : units >= 2 && units <= 4
          ? "главы"
          : "глав";
  return `${String(count)} ${word}`;
}

function StepLink({
  step,
  current,
  progress,
}: {
  readonly step: CourseReadingStep;
  readonly current: string;
  readonly progress: CourseStepProgress;
}) {
  return (
    <IntentPrefetchLink
      className={styles["step"]}
      data-course-step={step.id}
      data-progress={progress}
      aria-current={step.id === current ? "step" : undefined}
      href={step.href}
    >
      <span aria-hidden="true" className={styles["markSlot"]}>
        <span className={styles["mark"]}>
          {progress === "done" ? <Check size={9} strokeWidth={3.5} /> : null}
        </span>
      </span>
      <span>
        {step.kind === "task" ? (
          <small>
            Задание
            {step.taskOrdinal === undefined
              ? ""
              : ` ${String(step.taskOrdinal)}`}
          </small>
        ) : null}
        <span
          className={styles["stepTitle"]}
          data-task-submitted={step.taskSubmitted === true ? true : undefined}
        >
          {step.title}
        </span>
        {step.taskSubmitted === true ? (
          <span className="sr-only">Сдано</span>
        ) : progress === "done" ? (
          <span className="sr-only">Пройдено</span>
        ) : null}
      </span>
    </IntentPrefetchLink>
  );
}

export function ProgrammeDialog({
  context,
  supplementary,
}: {
  readonly supplementary: boolean;
  readonly context: CourseReadingContext;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const element = dialog.current;
    const unsubscribe = subscribeShellBreakpoint((desktop) => {
      if (desktop) element?.close();
    });
    return () => {
      unsubscribe();
      element?.close();
    };
  }, [pathname, context.current.id]);
  const chapter = context.chapters.find(
    (entry) => entry.id === context.currentChapterId,
  );
  const chapterStep =
    (chapter?.steps.findIndex((step) => step.id === context.current.id) ?? -1) +
    1;
  const chapterTotal = chapter?.steps.length ?? 0;
  const chapterLabel = `Глава ${String(chapter?.ordinal ?? 1)}`;
  const atProgrammeStep =
    !supplementary || isProgrammeStepOpenedForReference(context);
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
      >
        <List size={18} aria-hidden="true" />
        {atProgrammeStep ? (
          <>
            {/* The visible position stays inside the accessible name. */}
            <span className="sr-only">Вся программа: </span>
            {chapterLabel}
            <span aria-hidden="true">·</span>
            <span className={styles["triggerPosition"]}>
              {chapterStep} из {chapterTotal}
            </span>
          </>
        ) : (
          "Вся программа"
        )}
      </button>
      <CourseNavigationBar label="Навигация по урокам">
        {supplementary ? null : context.previous === null ? (
          <button type="button" disabled aria-label="Предыдущий шаг">
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        ) : (
          <CourseNavigationItem
            icon={ArrowLeft}
            label="Предыдущий шаг"
            title={context.previous.title}
            href={context.previous.href}
          />
        )}
        <CourseNavigationItem
          label="Программа"
          onClick={openProgramme}
          opensProgramme
          current
          caption={
            atProgrammeStep
              ? `${chapterLabel} · ${String(chapterStep)}/${String(chapterTotal)}`
              : context.currentPosition === 0
                ? "Дополнительный материал"
                : "Ваше место в курсе"
          }
        />
        {supplementary ? null : context.next === null ? (
          <button type="button" disabled aria-label="Следующий шаг">
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <CourseNavigationItem
            icon={ArrowRight}
            label="Следующий шаг"
            title={context.next.title}
            href={context.next.href}
          />
        )}
      </CourseNavigationBar>
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
          <IntentPrefetchLink
            className={styles["dialogCourseLink"]}
            href={context.href}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>К прохождению курса</span>
          </IntentPrefetchLink>
        </div>
        <CourseRail context={context} variant="sheet" />
      </dialog>
    </div>
  );
}
