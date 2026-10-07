import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  Eye,
  FileText,
  Flag,
  LockKeyhole,
  MessageSquareText,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  formatSubmissionDay,
  formatSubmissionMoment,
  productTaskAgentPhrase,
} from "@/entities/product-task";
import { ProductTaskForm } from "@/features/product-task-submission";
import { Button } from "@/shared/ui/button";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { materialPath } from "@/shared/routing/public-page-path";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

import type {
  ProductTaskPlace,
  OpenProductTask,
  OwnSubmissionsView,
  TaskCriterion,
} from "../model/product-task-page";
import { AgentPhrase } from "./agent-phrase.client";

export interface ProductTaskViewProps {
  readonly page: OpenProductTask;
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
}: ProductTaskViewProps) {
  const { task } = page;
  const criteria = task.definition.criteria;
  const additional = criteria.some(({ level }) => level === "additional");
  const parts = [
    ["situation", "Ситуация"],
    ["result", "Результат"],
    ["required", "Обязательно"],
    ...(additional ? [["additional", "Дополнительно"] as const] : []),
    ["freedom", "Свобода"],
    ["submit", "Сдача"],
    ["mine", "Мои сдачи"],
  ] as const;
  const latest =
    submissions.kind === "ready" ? submissions.submissions[0] : undefined;
  return (
    <div
      className="@container/task mx-auto min-w-0 max-w-[43rem] pb-16"
      data-product-task={task.code}
      data-product-task-state="open"
    >
      <TaskBackLink task={task} />
      <header className="mt-4" data-task-header>
        <TaskEyebrow task={task} />
        <h1 className="mt-4 break-words text-balance text-2xl font-semibold leading-[1.18] tracking-[-0.025em] md:text-[1.75rem] md:leading-[1.2]">
          {task.title}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {submissions.kind !== "ready" ? null : latest === undefined ? (
            <span className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 font-medium">
              Ещё не сдано
            </span>
          ) : (
            <span
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--callout-good)_14%,transparent)] px-3 font-semibold text-[color:var(--callout-good)]"
              data-task-submitted
            >
              <CircleCheck aria-hidden="true" className="size-4" />
              Сдано {formatSubmissionDay(latest.submittedAt)}
            </span>
          )}
          <span>Требования: версия {task.version}</span>
        </div>
        <nav aria-label="Части задания" className="mt-5 flex flex-wrap gap-2">
          {parts.map(([id, label]) => (
            <a
              className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm no-underline hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              href={`#task-${id}`}
              key={id}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <div className="mt-10 grid gap-10 text-pretty text-[1.0625rem] leading-[1.7]">
        <TaskSection id="situation" title="Ситуация">
          <p className="whitespace-pre-line text-body-muted">
            {task.definition.situation}
          </p>
        </TaskSection>
        <TaskSection id="result" title="Результат">
          <p className="mb-3 text-body-muted">В конце работает так:</p>
          <ul className="grid gap-2.5">
            {task.definition.result.map((item, index) => (
              <li className="flex gap-3" key={`${String(index)}-${item}`}>
                <Check
                  aria-hidden="true"
                  className="mt-1.5 size-4 shrink-0 text-[color:var(--callout-good)]"
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
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

        <section
          aria-labelledby="task-submit-heading"
          className="scroll-mt-6 rounded-2xl bg-muted/60 p-5 sm:p-6"
          id="task-submit"
        >
          <h2
            className="text-xl font-semibold tracking-[-0.015em]"
            id="task-submit-heading"
          >
            Сдача
          </h2>
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
                Один раз для всех заданий. Подходит Claude Code, Codex, OpenCode
                и другой агент с MCP по HTTP. Войди тем же аккаунтом, что и на
                сайте.
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
                запустит, только если ты разрешишь именно её. Перед отправкой
                агент покажет весь отчёт и поможет написать заметку в 5–7 строк.
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

        <TaskSection id="mine" title="Мои сдачи">
          <OwnSubmissions
            currentVersion={task.version}
            returnTo={returnTo}
            submissions={submissions}
          />
        </TaskSection>

        {page.relatedMaterials.length === 0 ? null : (
          <section aria-labelledby="task-related-heading">
            <h2
              className="text-xl font-semibold tracking-[-0.015em]"
              id="task-related-heading"
            >
              Материалы к заданию
            </h2>
            <ul className="mt-3 grid gap-2">
              {page.relatedMaterials.map((material) => (
                <li key={material.slug}>
                  <IntentPrefetchLink
                    className="flex min-h-14 items-center gap-3 rounded-xl bg-muted/65 px-4 py-2 text-base no-underline hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    href={materialPath(material.slug)}
                  >
                    <span className="min-w-0 flex-1 text-sm font-medium leading-6 [overflow-wrap:anywhere]">
                      {material.title}
                    </span>
                    {material.availability === "available" ? (
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <>
                        <LockKeyhole
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="sr-only">Нужен доступ</span>
                      </>
                    )}
                  </IntentPrefetchLink>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * A task the reader cannot open: only its title and chapter, like a closed Material (owner,
 * 05.10.2026). The sale lives in the programme, so the one action leads there.
 */
export function ProductTaskClosed({
  task,
}: {
  readonly task: ProductTaskPlace;
}) {
  return (
    <div
      className="mx-auto min-w-0 max-w-[43rem] pb-16"
      data-product-task={task.code}
      data-product-task-state="closed"
    >
      <TaskBackLink task={task} />
      <header className="mt-4">
        <TaskEyebrow task={task} />
        <h1 className="mt-4 break-words text-balance text-2xl font-semibold leading-[1.18] tracking-[-0.025em] md:text-[1.75rem] md:leading-[1.2]">
          {task.title}
        </h1>
      </header>
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
            <IntentPrefetchLink href={productProgrammeHref(task.product.slug)}>
              К программе и оплате
              <ArrowRight aria-hidden="true" />
            </IntentPrefetchLink>
          </Button>
        </div>
      </section>
    </div>
  );
}

function TaskBackLink({ task }: { readonly task: ProductTaskPlace }) {
  return (
    <nav aria-label="Путь навигации" className="pt-4" data-task-return>
      <IntentPrefetchLink
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground no-underline hover:text-foreground"
        href={productProgrammeHref(task.product.slug)}
      >
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
        <span>{task.product.name} · программа</span>
      </IntentPrefetchLink>
    </nav>
  );
}

function TaskEyebrow({ task }: { readonly task: ProductTaskPlace }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-semibold text-[color:var(--callout-task)]">
        <Flag aria-hidden="true" className="size-4" />
        Задание
      </span>
      <span aria-hidden="true">·</span>
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
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <section
      aria-labelledby={`task-${id}-heading`}
      className="scroll-mt-6"
      id={`task-${id}`}
    >
      <h2
        className="mb-3 text-xl font-semibold tracking-[-0.015em]"
        id={`task-${id}-heading`}
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
            <p className="[overflow-wrap:anywhere]">{criterion.requirement}</p>
            {compact ? null : (
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
  returnTo,
  submissions,
}: {
  readonly currentVersion: number;
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
        Сдачи сейчас не загрузились. Обнови страницу чуть позже.
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
                  <CriteriaList compact criteria={criteria} level="required" />
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
  );
}
