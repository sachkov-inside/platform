import { ReaderHistoryTracker } from "@/shared/ui/reader-history.client";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { internalRoute } from "@/shared/routing/internal-route";
import Link from "next/link";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  Eye,
  FileText,
  LockKeyhole,
  MessageSquareText,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ReactNode } from "react";

import { materialSourceAnchors } from "@/entities/material";
import {
  formatSubmissionDay,
  formatSubmissionMoment,
  productTaskAgentPhrase,
} from "@/entities/product-task";
import {
  CourseReadingLayout,
  CourseReadingHeader,
  CourseReadingFooter,
  type CourseReadingContext,
} from "@/features/library-discovery";
import styles from "./product-task-view.module.css";
import { TaskPageBody } from "./task-page-body";
import { TaskRelatedMaterials } from "./task-related-materials.client";
import { taskRelatedSectionOrder } from "../model/task-related-section";

import { ProductTaskForm } from "@/features/product-task-submission";
import { Button } from "@/shared/ui/button";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";

import type {
  ProductTaskPlace,
  OpenProductTask,
  OwnSubmissionsView,
  TaskCriterion,
} from "../model/product-task-page";
import { AgentPhrase } from "./agent-phrase.client";

export interface ProductTaskViewProps {
  readonly page: OpenProductTask;
  readonly programme?: CourseReadingContext | null;
  readonly submissions: OwnSubmissionsView;
  /** The learner MCP address from web configuration (#938). */
  readonly learnerMcpUrl: string;
  /** Where sign-in returns a guest: this task page. */
  readonly returnTo: string;
}

/**
 * The Product Task page, variant A «Документ» accepted by the owner on 05.10.2026 (#947): one column
 * like a Reader lesson, the parts in order, «Сдача» inside the text with the fallback form folded,
 * then «Мои сдачи» and the related Materials.
 */
export function ProductTaskView({
  learnerMcpUrl,
  page,
  returnTo,
  submissions,
  programme = null,
}: ProductTaskViewProps) {
  const { task } = page;
  const sourceIds = new Set(
    materialSourceAnchors(task.page?.body.blocks ?? []).values(),
  );
  const pageId = (id: string) => (sourceIds.has(id) ? `${id}:page` : id);
  const criteria = task.definition.criteria;
  const additional = criteria.some(({ level }) => level === "additional");
  const latest =
    submissions.kind === "ready"
      ? (submissions.latestSubmittedAt ?? undefined)
      : undefined;
  const submissionBlock = (
    <section
      aria-labelledby={
        "format" in task.definition ? undefined : pageId("task-submit-heading")
      }
      aria-label={"format" in task.definition ? "Сдать" : undefined}
      className={styles["submission"]}
      id={pageId("task-submit")}
    >
      {"format" in task.definition ? null : (
        <h2
          className="text-xl font-semibold tracking-[-0.015em]"
          id={pageId("task-submit-heading")}
        >
          Сдача
        </h2>
      )}
      {submissions.kind !== "ready" ? null : (
        <p
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"
          data-task-submitted={latest === undefined ? undefined : "true"}
        >
          {latest === undefined ? (
            "Ещё не сдано"
          ) : (
            <>
              <CircleCheck aria-hidden="true" className="size-4" />
              Сдано {formatSubmissionDay(latest)}
            </>
          )}
        </p>
      )}
      <p className="mt-2 text-[0.9375rem] leading-7 text-body-muted">
        Сдаёт твой агент: он проверит проект по критериям и отправит отчёт с
        твоего согласия.
      </p>
      {page.submission.accepting ? null : (
        <p
          className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--callout-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--callout-warning)_10%,transparent)] px-4 py-3 text-sm leading-6"
          role="status"
        >
          Приём сдач скоро откроется. Агент уже может проверить проект, но
          отправить сдачу пока нельзя.
        </p>
      )}
      <ol className="mt-5 grid gap-5 text-base">
        <SubmitStep number={1} title="Подключи учебный MCP к своему агенту">
          <p className="text-sm leading-6 text-body-muted">
            Один раз для всех заданий. Подходит Claude Code, Codex, OpenCode и
            другой агент с MCP по HTTP. Войди тем же аккаунтом, что и на сайте.
          </p>
          <p className="mt-2 rounded-lg bg-card px-3 py-2 font-mono text-[0.8125rem] [overflow-wrap:anywhere]">
            {learnerMcpUrl}
          </p>
          <a
            className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-4"
            href="/practice-review-setup.txt"
            rel="noreferrer"
            target="_blank"
          >
            Инструкция подключения
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </SubmitStep>
        <SubmitStep number={2} title="Передай агенту эту фразу">
          <AgentPhrase text={productTaskAgentPhrase(task.code)} />
        </SubmitStep>
        <SubmitStep number={3} title="Проверь отчёт и подтверди отправку">
          <p className="text-sm leading-6 text-body-muted">
            Агент прочитает задание и проект, ничего не меняя. Команду он
            запустит, только если ты разрешишь именно её. Перед отправкой агент
            покажет весь отчёт и поможет написать заметку в 5–7 строк.
          </p>
        </SubmitStep>
      </ol>
      <Disclosure
        className="mt-5"
        title="Процедура проверки, которую получает агент"
      >
        <p className="text-sm leading-6 text-body-muted">
          Тот же текст отдаёт учебный MCP. Версия процедуры{" "}
          {page.reviewProtocol.version}.
        </p>
        <ol
          className="mt-3 grid list-decimal gap-2 pl-5 font-mono text-[0.75rem] leading-5 text-body-muted"
          lang="en"
        >
          {page.reviewProtocol.instructions.map((line, index) => (
            <li key={String(index)}>{line}</li>
          ))}
        </ol>
      </Disclosure>
      <Disclosure
        className="mt-3 bg-card"
        dataAttribute="fallback-form"
        title="Нет агента с MCP? Сдать через форму"
      >
        {submissions.kind === "guest" ? (
          <SignIn
            explanation="Сдача сохраняется в твоём аккаунте. Войди, чтобы отправить её."
            returnTo={returnTo}
          />
        ) : (
          <ProductTaskForm
            accepting={page.submission.accepting}
            code={task.code}
            taskVersion={task.version}
          />
        )}
      </Disclosure>
    </section>
  );
  const mineBlock = (
    <TaskSection
      id="mine"
      sectionId={pageId("task-mine")}
      headingId={pageId("task-mine-heading")}
      title="Мои сдачи"
    >
      <OwnSubmissions
        historyAnchor={pageId("task-mine")}
        currentVersion={task.version}
        returnTo={returnTo}
        submissions={submissions}
      />
    </TaskSection>
  );
  return (
    <CourseReadingLayout context={programme}>
      <ReaderHistoryTracker
        path={productTaskHref(task.product.slug, task.code)}
      />
      <div
        className={cn("@container/task", styles["task"])}
        data-product-task={task.code}
        data-product-task-state="open"
      >
        {programme === null ? <TaskBackLink task={task} /> : null}
        {programme === null ? (
          <header className="mt-4" data-task-header>
            <TaskEyebrow task={task} />
            <h1 className="mt-4 break-words text-balance text-2xl font-semibold leading-[1.18] tracking-[-0.025em] md:text-[1.75rem] md:leading-[1.2]">
              {task.page?.title ?? task.title}
            </h1>
          </header>
        ) : (
          <div data-task-header>
            <CourseReadingHeader
              context={programme}
              title={task.page?.title ?? task.title}
              metadata={null}
            />
          </div>
        )}

        <div className={styles["body"]}>
          {taskRelatedSectionOrder(task.page?.body.blocks ?? []) ===
          undefined ? (
            <TaskRelatedMaterials
              anchor={{ kind: "task", code: task.code }}
              headingId={pageId("task-related-heading")}
              materials={page.relatedMaterials}
              returnTo={
                programme?.href ?? productProgrammeHref(task.product.slug)
              }
            />
          ) : null}
          {task.page === undefined ? (
            <>
              <TaskSection id="situation" title="Ситуация">
                <p className="whitespace-pre-line text-body-muted">
                  {"situation" in task.definition
                    ? task.definition.situation
                    : task.definition.intro}
                </p>
              </TaskSection>
              <TaskSection id="result" title="Результат">
                <p className="mb-3 text-body-muted">В конце работает так:</p>
                <ul className="grid gap-2.5">
                  {("result" in task.definition
                    ? task.definition.result
                    : []
                  ).map((item, index) => (
                    <li className="flex gap-3" key={`${String(index)}-${item}`}>
                      <Check
                        aria-hidden="true"
                        className="mt-1.5 size-4 shrink-0 text-[color:var(--callout-good)]"
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </TaskSection>
              <TaskSection id="required" title="Обязательно">
                <p className="mb-4 text-sm text-muted-foreground">
                  Без этого задание не сдано.
                </p>
                <CriteriaList criteria={criteria} level="required" />
              </TaskSection>
              {additional ? (
                <TaskSection id="additional" title="Дополнительно">
                  <p className="mb-4 text-sm text-muted-foreground">
                    Глубина для тех, кто хочет больше. На сдачу не влияет.
                  </p>
                  <CriteriaList criteria={criteria} level="additional" />
                </TaskSection>
              ) : null}
              <TaskSection id="freedom" title="Свобода">
                <p className="whitespace-pre-line text-body-muted">
                  {task.definition.freedom}
                </p>
              </TaskSection>
            </>
          ) : (
            <TaskPageBody
              version={task.version}
              page={task.page}
              code={task.code}
              productSlug={task.product.slug}
              relatedMaterials={page.relatedMaterials}
              returnTo={
                programme?.href ?? productProgrammeHref(task.product.slug)
              }
            >
              {submissionBlock}
              {mineBlock}
            </TaskPageBody>
          )}

          {task.page === undefined ? (
            <>
              {submissionBlock}
              {mineBlock}
            </>
          ) : null}
        </div>
        {programme === null ? null : (
          <CourseReadingFooter context={programme} />
        )}
      </div>
    </CourseReadingLayout>
  );
}

/**
 * A task the reader cannot open: only its title and chapter, like a closed Material (owner,
 * 05.10.2026). The sale lives in the programme, so the one action leads there.
 */
export function ProductTaskClosed({
  task,
  programme = null,
}: {
  readonly task: ProductTaskPlace;
  readonly programme?: CourseReadingContext | null;
}) {
  return (
    <CourseReadingLayout context={programme}>
      <ReaderHistoryTracker
        path={productTaskHref(task.product.slug, task.code)}
      />
      <div
        className={styles["task"]}
        data-product-task={task.code}
        data-product-task-state="closed"
      >
        {programme === null ? <TaskBackLink task={task} /> : null}
        {programme === null ? (
          <header className="mt-4">
            <TaskEyebrow task={task} />
            <h1 className="mt-4 break-words text-balance text-2xl font-semibold leading-[1.18] tracking-[-0.025em] md:text-[1.75rem] md:leading-[1.2]">
              {task.title}
            </h1>
          </header>
        ) : (
          <div data-task-header>
            <CourseReadingHeader
              context={programme}
              title={task.title}
              metadata={null}
            />
          </div>
        )}
        <section
          aria-labelledby="task-access-heading"
          className="relative mt-10 overflow-hidden rounded-[2rem] border border-black/6 bg-muted p-6 md:mt-12 md:p-9"
        >
          <div
            aria-hidden="true"
            className="select-none space-y-5 opacity-45 blur-[7px]"
          >
            <div className="h-7 w-2/3 rounded-full bg-placeholder-strong" />
            <div className="space-y-3">
              <div className="h-4 rounded-full bg-placeholder" />
              <div className="h-4 w-11/12 rounded-full bg-placeholder" />
              <div className="h-4 w-4/5 rounded-full bg-placeholder" />
            </div>
            <div className="h-36 rounded-[1.5rem] bg-white" />
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-white/20 via-white/70 to-white/95 px-6 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-white text-accent shadow-lg">
              <LockKeyhole aria-hidden="true" className="size-5" />
            </span>
            <h2
              className="mt-4 text-balance text-2xl font-semibold tracking-[-0.04em]"
              id="task-access-heading"
            >
              Задание открывается вместе с продуктом
            </h2>
            <p className="mt-2 max-w-sm text-pretty text-sm leading-6 text-muted-foreground">
              Ситуация, критерии и сдача станут доступны после покупки «
              {task.product.name}».
            </p>
            <Button
              asChild
              className="mt-5 h-auto min-h-11 max-w-full whitespace-normal rounded-xl bg-accent px-4 text-white hover:bg-accent-hover"
              size="lg"
            >
              <IntentPrefetchLink
                href={productProgrammeHref(task.product.slug)}
              >
                К программе и оплате
                <ArrowRight aria-hidden="true" />
              </IntentPrefetchLink>
            </Button>
          </div>
        </section>
        {programme === null ? null : (
          <CourseReadingFooter context={programme} />
        )}
      </div>
    </CourseReadingLayout>
  );
}

function TaskBackLink({ task }: { readonly task: ProductTaskPlace }) {
  return (
    <div data-task-return>
      <Breadcrumbs
        items={[
          {
            label: task.product.name,
            href: productProgrammeHref(task.product.slug),
          },
          {
            label: `Глава ${String(task.chapter.ordinal)}`,
            fullLabel: task.chapter.name,
            href: productProgrammeHref(task.product.slug),
          },
          { label: task.title },
        ]}
      />
    </div>
  );
}

function TaskEyebrow({ task }: { readonly task: ProductTaskPlace }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
        Глава {task.chapter.ordinal}. {task.chapter.name}
      </span>
    </p>
  );
}

function TaskSection({
  children,
  id,
  title,
  sectionId = `task-${id}`,
  headingId = `task-${id}-heading`,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly title: string;
  readonly sectionId?: string;
  readonly headingId?: string;
}) {
  return (
    <section aria-labelledby={headingId} className="scroll-mt-6" id={sectionId}>
      <h2
        className="mb-3 text-xl font-semibold tracking-[-0.015em]"
        id={headingId}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function CriteriaList({
  compact = false,
  criteria,
  level,
}: {
  readonly compact?: boolean;
  readonly criteria: readonly TaskCriterion[];
  readonly level: TaskCriterion["level"];
}) {
  return (
    <ol className="grid list-decimal gap-4 pl-6 marker:font-semibold marker:text-muted-foreground">
      {criteria
        .filter((criterion) => criterion.level === level)
        .map((criterion) => (
          <li className="min-w-0" key={criterion.id}>
            <p className="[overflow-wrap:anywhere]">
              {"requirement" in criterion
                ? criterion.requirement
                : criterion.task}
            </p>
            {compact || !("acceptableEvidence" in criterion) ? null : (
              <details className="group mt-1.5">
                <InlineSummary className="min-h-8 font-normal">
                  Чем подтвердить
                </InlineSummary>
                <ul className="mt-1 grid gap-1 border-l-2 border-border pl-3 text-sm leading-6 text-body-muted">
                  {criterion.acceptableEvidence.map((evidence, index) => (
                    <li key={String(index)}>{evidence}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
    </ol>
  );
}

function SubmitStep({
  children,
  number,
  title,
}: {
  readonly children: ReactNode;
  readonly number: number;
  readonly title: string;
}) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
      >
        {number}
      </span>
      <div className="min-w-0">
        <h3 className="flex min-h-8 items-center font-semibold">{title}</h3>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}

function Disclosure({
  children,
  className = "",
  dataAttribute,
  title,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly dataAttribute?: string;
  readonly title: string;
}) {
  return (
    <details
      className={`group rounded-xl border border-border ${className}`}
      data-task-disclosure={dataAttribute}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <Chevron />
      </summary>
      <div className="px-4 pb-4 text-base">{children}</div>
    </details>
  );
}

/** The summary of a small inline disclosure: muted text and a chevron that turns when open. */
function InlineSummary({
  children,
  className = "min-h-9 font-medium",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <summary
      className={`inline-flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden ${className}`}
    >
      {children}
      <Chevron />
    </summary>
  );
}

function Chevron() {
  return (
    <ChevronDown
      aria-hidden="true"
      className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
    />
  );
}

function SignIn({
  explanation,
  returnTo,
}: {
  readonly explanation: string;
  readonly returnTo: string;
}) {
  return (
    <div className="grid justify-items-start gap-3">
      <p className="text-sm leading-6 text-body-muted">{explanation}</p>
      <form action="/auth/sign-in" method="post">
        <input name="returnTo" type="hidden" value={returnTo} />
        <Button className="min-h-11" type="submit" variant="outline">
          Войти
        </Button>
      </form>
    </div>
  );
}

function OwnSubmissions({
  currentVersion,
  historyAnchor,
  returnTo,
  submissions,
}: {
  readonly currentVersion: number;
  readonly historyAnchor: string;
  readonly returnTo: string;
  readonly submissions: OwnSubmissionsView;
}) {
  if (submissions.kind === "guest")
    return (
      <SignIn
        explanation="Здесь будут твои сдачи, комментарий автора и отметка «посмотрел автор»."
        returnTo={returnTo}
      />
    );
  if (submissions.kind === "unavailable")
    return (
      <p className="text-sm leading-6 text-muted-foreground" role="status">
        Сдачи сейчас не загрузились.
        <RetryPageButton />
        <Link href={internalRoute(`${returnTo}#${historyAnchor}`)}>
          К новым сдачам
        </Link>
      </p>
    );
  if (submissions.submissions.length === 0 && submissions.continued === true)
    return (
      <p>
        Более ранних сдач нет.{" "}
        <Link href={internalRoute(`${returnTo}#${historyAnchor}`)}>
          К новым сдачам
        </Link>
      </p>
    );
  if (submissions.submissions.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm leading-6 text-muted-foreground">
        Здесь появятся твои сдачи, комментарий автора и отметка «посмотрел
        автор». Сдавать можно сколько угодно раз: прежние сдачи остаются.
      </p>
    );
  const criteriaOf = new Map(
    submissions.versions.map((version) => [version.version, version.criteria]),
  );
  return (
    <>
      <ol className="grid border-l-2 border-border" data-own-submissions>
        {submissions.submissions.map((submission) => {
          const criteria = criteriaOf.get(submission.taskVersion) ?? [];
          const feedback = submission.authorFeedback;
          return (
            <li
              className="relative pb-8 pl-6 last:pb-0"
              data-submission={submission.submissionId}
              key={submission.submissionId}
            >
              <span
                aria-hidden="true"
                className="absolute -left-[0.45rem] top-2 size-3 rounded-full border-2 border-background bg-accent"
              />
              <h3 className="font-semibold">
                <time dateTime={submission.submittedAt}>
                  {formatSubmissionMoment(submission.submittedAt)}
                </time>
              </h3>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {submission.source === "mcp" ? (
                  <span className="inline-flex items-center gap-1">
                    <Bot aria-hidden="true" className="size-3.5" />
                    Через агента
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <FileText aria-hidden="true" className="size-3.5" />
                    Через форму
                  </span>
                )}
                <span>
                  Версия требований {submission.taskVersion}
                  {submission.taskVersion === currentVersion
                    ? ""
                    : ` (сейчас ${String(currentVersion)})`}
                </span>
                {submission.repositoryUrl === null ? null : (
                  <span className="[overflow-wrap:anywhere]">
                    {submission.repositoryUrl.replace(/^https?:\/\//u, "")}
                  </span>
                )}
              </p>
              <p className="mt-3 whitespace-pre-line text-[0.9375rem] leading-7 text-body-muted [overflow-wrap:anywhere]">
                {submission.note}
              </p>
              <div className="mt-3 grid gap-2">
                {feedback === null || feedback.reviewedAt === null ? null : (
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--callout-good)]">
                    <Eye aria-hidden="true" className="size-4" />
                    Посмотрел автор {formatSubmissionDay(feedback.reviewedAt)}
                  </p>
                )}
                {feedback === null || feedback.comment === null ? null : (
                  <figure className="rounded-xl bg-[color-mix(in_srgb,var(--accent)_8%,var(--card))] px-4 py-3 text-[0.9375rem] leading-7">
                    <figcaption className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-action">
                      <MessageSquareText
                        aria-hidden="true"
                        className="size-3.5"
                      />
                      Комментарий автора
                    </figcaption>
                    <blockquote className="whitespace-pre-line [overflow-wrap:anywhere]">
                      {feedback.comment}
                    </blockquote>
                  </figure>
                )}
                {feedback === null ? (
                  <p className="text-sm text-muted-foreground">
                    Автор ещё не смотрел.
                  </p>
                ) : null}
              </div>
              {submission.reportText === null ? null : (
                <details className="group mt-2">
                  <InlineSummary>Мой отчёт</InlineSummary>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-body-muted [overflow-wrap:anywhere]">
                    {submission.reportText}
                  </p>
                </details>
              )}
              {criteria.length === 0 ? null : (
                <details className="group mt-1">
                  <InlineSummary>
                    Критерии версии {submission.taskVersion}
                    {submission.taskVersion === currentVersion
                      ? " (текущей)"
                      : ""}
                  </InlineSummary>
                  <div className="mt-2 grid gap-3 text-sm leading-6">
                    <p className="font-semibold">Обязательно</p>
                    <CriteriaList
                      compact
                      criteria={criteria}
                      level="required"
                    />
                    {criteria.some(({ level }) => level === "additional") ? (
                      <>
                        <p className="font-semibold">Дополнительно</p>
                        <CriteriaList
                          compact
                          criteria={criteria}
                          level="additional"
                        />
                      </>
                    ) : null}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <nav
        aria-label="Страницы моих сдач"
        className="mt-5 flex flex-wrap gap-4 text-sm"
      >
        {submissions.continued === true ? (
          <Link href={internalRoute(`${returnTo}#${historyAnchor}`)}>
            К новым сдачам
          </Link>
        ) : null}
        {submissions.nextCursor === null ? null : (
          <Link
            href={internalRoute(
              `${returnTo}?attemptsAfter=${encodeURIComponent(submissions.nextCursor)}#${historyAnchor}`,
            )}
          >
            Предыдущие сдачи
          </Link>
        )}
      </nav>
    </>
  );
}
