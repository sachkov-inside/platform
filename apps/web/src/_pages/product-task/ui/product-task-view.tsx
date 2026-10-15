import { TaskMcpSetup } from "./task-mcp-setup.client";
import { TaskSubmissionHistory } from "./task-submission-history.client";
import { ReaderHistoryTracker } from "@/shared/ui/reader-history.client";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { ArrowRight, Check, ChevronDown, LockKeyhole } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ReactNode } from "react";

import { materialSourceAnchors } from "@/entities/material";
import { productTaskAgentPhrase } from "@/entities/product-task";
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
  readonly learnerMcpSetupUrl?: string;
  readonly liveSubmissions?: boolean;
  readonly attemptsAfter?: string;
  readonly accountId?: string | null;
  /** Where sign-in returns a guest: this task page. */
  readonly returnTo: string;
}

/**
 * The authored task remains a document. The page owns a separate submission workspace (#1504).
 */
export function ProductTaskView({
  learnerMcpUrl,
  learnerMcpSetupUrl = "/practice-review-setup.txt",
  liveSubmissions = true,
  attemptsAfter,
  accountId = null,
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
  const submissionBlock = (
    <section
      className={styles["workspace"]}
      id={pageId("task-submit")}
      aria-labelledby={pageId("task-submit-heading")}
    >
      <header className="grid gap-3">
        <h2
          className="text-2xl font-semibold tracking-tight"
          id={pageId("task-submit-heading")}
        >
          Сдача задания
        </h2>
        <p className="text-sm leading-6 text-body-muted">
          Агент проверяет проект. Здесь — подключение, начало проверки и её
          результат.
        </p>
      </header>
      <ol className={styles["roadmap"]}>
        <li className={styles["step"]}>
          <span className={styles["stepNumber"]} aria-hidden="true">
            1
          </span>
          <TaskMcpSetup url={learnerMcpUrl} setupUrl={learnerMcpSetupUrl} />
        </li>
        <li className={styles["step"]}>
          <span className={styles["stepNumber"]} aria-hidden="true">
            2
          </span>
          <div className={styles["stepContent"]}>
            <h3 className="text-lg font-semibold">Начало проверки</h3>
            <p className={styles["stepDescription"]}>
              Открой новую сессию агента в папке проекта, где ты выполнил
              задание.
            </p>
            <p className="text-sm leading-6">
              Передай запрос в новой сессии. Агент проверит работу, покажет
              отчёт и попросит подтвердить отправку.
            </p>
            <AgentPhrase text={productTaskAgentPhrase(task.code)} />
            <p className={styles["stepDescription"]}>
              Работай и обсуждай замечания у агента. Здесь появятся статус
              проверки и краткий отчёт.
            </p>
            {page.submission.accepting ? null : (
              <p role="status" className="text-sm leading-6">
                Приём сдач скоро откроется. Проверить работу у агента уже можно.
              </p>
            )}
          </div>
        </li>
        <li className={styles["step"]}>
          <span className={styles["stepNumber"]} aria-hidden="true">
            3
          </span>
          <div className={styles["stepContent"]}>
            <h3 className="text-lg font-semibold">
              Результат и обратная связь
            </h3>
            <p className={styles["stepDescription"]}>
              Статус проверки, твои сдачи и ответ автора — в одном месте.
            </p>
            <section
              className={styles["history"]}
              id={pageId("task-mine")}
              aria-labelledby={pageId("task-mine-heading")}
            >
              <h4
                className="text-sm font-semibold"
                id={pageId("task-mine-heading")}
              >
                Мои сдачи
              </h4>
              <TaskSubmissionHistory
                initial={submissions}
                code={task.code}
                currentVersion={task.version}
                returnTo={returnTo}
                historyAnchor={pageId("task-mine")}
                live={liveSubmissions}
                after={attemptsAfter}
                accountId={accountId}
                key={
                  submissions.kind === "ready"
                    ? (submissions.latestSubmittedAt ?? "empty")
                    : submissions.kind
                }
              />
            </section>
          </div>
        </li>
      </ol>
      <Disclosure
        title="Нет агента с MCP? Сдать через форму"
        dataAttribute="fallback-form"
      >
        {submissions.kind === "guest" ? (
          <SignIn
            explanation="Войди, чтобы отправить сдачу."
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
            />
          )}
        </div>
        {submissionBlock}
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
