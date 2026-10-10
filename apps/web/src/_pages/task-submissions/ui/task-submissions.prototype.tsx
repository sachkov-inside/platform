"use client";

import { ArrowLeft, ArrowRight, Bot, FileText, Inbox } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { formatSubmissionMoment } from "@/entities/product-task";
import { Button } from "@/shared/ui/button";

import {
  criteriaOf,
  repositoryLink,
  type AuthorSubmission,
  type TaskSubmissions,
} from "../model/task-submissions";

/**
 * Throwaway #967 proof: A queue + reading pane, B table + detail, C a review feed.
 * Only its Storybook story imports this module. No production route or real mutation.
 * ?variant=A|B|C keeps the choice shareable; the authoring shell stays unchanged.
 */
const variants = ["A", "B", "C"] as const;
type Variant = (typeof variants)[number];
export type ProofState = "ready" | "loading" | "empty" | "error" | "denied";
interface FeedbackDraft {
  readonly comment: string;
  readonly reviewed: boolean;
  readonly saved: boolean;
  readonly savedReviewed: boolean;
}
const names = { A: "Очередь и отчёт", B: "Таблица и отчёт", C: "Лента сдач" };
const fieldClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30";
const labels = {
  confirmed: "Подтверждено",
  violation: "Нарушение",
  not_verified: "Не проверено",
};

export function TaskSubmissionsPrototype({
  submissions,
  initialVariant = "A",
  state = "ready",
}: {
  readonly submissions: TaskSubmissions;
  readonly initialVariant?: Variant;
  readonly state?: ProofState;
}) {
  const [variant, setVariant] = useState(initialVariant);
  const [productId, setProductId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [taskCode, setTaskCode] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const [feedback, setFeedback] = useState<Readonly<Record<string, FeedbackDraft>>>({});
  function changeFeedback(id: string, draft: FeedbackDraft) {
    setFeedback((current) => ({ ...current, [id]: draft }));
  }
  function wasReviewed(item: AuthorSubmission) {
    return feedback[item.submissionId]?.savedReviewed ?? (item.authorFeedback !== null && item.authorFeedback.reviewedAt !== null);
  }
  const product = submissions.products.find((item) => item.id === productId);
  const chapters = product?.chapters ?? [];
  const chapter = chapters.find((item) => item.id === chapterId);
  const tasks = (chapter === undefined
    ? (product?.chapters ?? submissions.products.flatMap((item) => item.chapters))
    : [chapter]
  ).flatMap((item) => item.tasks);
  const rows = submissions.submissions.filter(
    (item) =>
      (productId === "" || item.task.productId === productId) &&
      (chapterId === "" || item.task.chapterId === chapterId) &&
      (taskCode === "" || item.task.code === taskCode),
  );
  const selected = rows.find((item) => item.submissionId === selectedId) ?? rows[0];
  const visibleState = retry ? "ready" : state;

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("variant");
    if (value === "A" || value === "B" || value === "C") setVariant(value);
  }, []);

  function chooseVariant(value: Variant) {
    setVariant(value);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", value);
    window.history.replaceState(null, "", url);
  }

  function cycleVariant(direction: number) {
    const next = variants[(variants.indexOf(variant) + direction + 3) % 3];
    if (next !== undefined) chooseVariant(next);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable], [role=region]") !== null
      )
        return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const next = variants[(variants.indexOf(variant) + direction + 3) % 3] ?? variant;
        chooseVariant(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  return (
    <main
      aria-labelledby="submissions-proof-title"
      className="h-full min-h-svh overflow-y-auto bg-background text-foreground md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="mx-auto grid max-w-7xl gap-7 px-4 py-7 pb-48 sm:px-8 md:pb-32 lg:px-10 lg:py-10">
        <p className="rounded-xl bg-secondary px-4 py-3 text-xs leading-5 text-secondary-foreground">
          Прототип #967. Синтетические данные. Отзыв сохраняется только в памяти,
          до перезагрузки. Текущий вариант: {variant} — {names[variant]}.
        </p>
        <header className="grid gap-2">
          <h1 className="text-3xl font-bold tracking-[-0.03em]" id="submissions-proof-title">Сдачи</h1>
          <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
            Сдачи учеников, новые сверху. Отчёт пишет агент ученика: Platform его
            не проверяет. Отзыв необязателен, оценок нет.
          </p>
        </header>
        {visibleState === "denied" ? null : (
          <form aria-label="Фильтр сдач" className="grid gap-3 border-b border-border pb-6 sm:grid-cols-3" onSubmit={(event) => event.preventDefault()}>
            <Field label="Продукт">
              <select className={fieldClass} value={productId} onChange={(event) => {
                setProductId(event.target.value); setChapterId(""); setTaskCode("");
              }}>
                <option value="">Все продукты</option>
                {submissions.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Глава">
              <select className={fieldClass} disabled={product === undefined} value={chapterId} onChange={(event) => {
                setChapterId(event.target.value); setTaskCode("");
              }}>
                <option value="">{product === undefined ? "Выберите продукт" : "Все главы"}</option>
                {chapters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Задание">
              <select className={fieldClass} value={taskCode} onChange={(event) => setTaskCode(event.target.value)}>
                <option value="">Все задания</option>
                {tasks.map((item) => <option key={item.code} value={item.code}>{item.title}</option>)}
              </select>
            </Field>
          </form>
        )}
        {visibleState === "loading" ? (
          <div aria-busy="true" className="grid gap-5" role="status">
            <p className="text-sm text-muted-foreground">Загружаем сдачи…</p>
            {["first", "second", "third"].map((key) => <div aria-hidden="true" className="h-24 rounded-xl bg-muted" key={key} />)}
          </div>
        ) : visibleState === "error" ? (
          <section className="grid justify-items-start gap-3 py-8" role="alert">
            <h2 className="text-lg font-semibold">Не удалось загрузить сдачи</h2>
            <p className="text-sm text-muted-foreground">Попробуйте ещё раз. Сохранённые сдачи остаются в Platform.</p>
            <Button onClick={() => setRetry(true)}>Повторить загрузку</Button>
          </section>
        ) : visibleState === "denied" ? (
          <section className="grid gap-2 py-8" role="alert">
            <h2 className="text-lg font-semibold">Нет доступа к сдачам</h2>
            <p className="text-sm text-muted-foreground">Этот раздел доступен автору. Откройте задание, чтобы посмотреть свои сдачи.</p>
          </section>
        ) : visibleState === "empty" || selected === undefined ? (
          <div className="flex items-start gap-3 py-10" role="status">
            <Inbox aria-hidden="true" className="size-5 shrink-0" />
            <div className="grid gap-2">
              <h2 className="text-lg font-semibold">{productId !== "" || taskCode !== "" ? "По этому фильтру сдач нет" : "Сдач пока нет"}</h2>
              <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">Сдачи появятся, когда ученики отправят задания через своего агента или форму на странице задания.</p>
            </div>
          </div>
        ) : variant === "A" ? (
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
            <section aria-label="Очередь сдач" className="min-w-0">
              <h2 className="mb-3 text-sm font-semibold">Сдачи в списке: {rows.length}</h2>
              <ol className="grid gap-2">
                {rows.map((item) => <li key={item.submissionId}><button
                  aria-pressed={selected.submissionId === item.submissionId}
                  className={`grid w-full min-w-0 gap-2 rounded-xl p-4 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30 ${selected.submissionId === item.submissionId ? "bg-secondary" : "border border-border"}`}
                  onClick={() => setSelectedId(item.submissionId)} type="button"
                >
                  <span className="text-sm font-semibold">{item.task.title}</span>
                  <span className="text-xs text-muted-foreground">{formatSubmissionMoment(item.submittedAt)} · Ученик {item.person.accountId.slice(-6)}</span>
                  <span className="text-xs">{wasReviewed(item) ? "Посмотрел автор" : "Автор ещё не отметил"}</span>
                </button></li>)}
              </ol>
            </section>
            <SubmissionDetail key={selected.submissionId} submission={selected} submissions={submissions} feedback={feedback[selected.submissionId]} onFeedbackChange={changeFeedback} />
          </div>
        ) : variant === "B" ? (
          <div className="grid min-w-0 gap-9">
            <div aria-label="Таблица сдач, прокручивается по горизонтали" className="min-w-0 overflow-x-auto rounded-xl border border-border focus-visible:ring-3 focus-visible:ring-ring/30" role="region" tabIndex={0}>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Сдачи, новые сверху</caption>
                <thead className="bg-secondary"><tr>{["Задание", "Ученик", "Дата и источник", "Отзыв"].map((text) => <th className="px-4 py-3 font-medium" key={text} scope="col">{text}</th>)}</tr></thead>
                <tbody>{rows.map((item) => <tr className={selected.submissionId === item.submissionId ? "bg-secondary/50" : "border-t border-border"} key={item.submissionId}>
                  <th className="min-w-40 px-4 py-4 font-medium" scope="row"><button aria-pressed={selected.submissionId === item.submissionId} className="min-h-11 text-left text-action underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSelectedId(item.submissionId)} type="button">{item.task.title}</button></th>
                  <td className="px-4 py-4">{item.person.accountId.slice(-6)}</td>
                  <td className="min-w-40 px-4 py-4 text-xs leading-5">{formatSubmissionMoment(item.submittedAt)}<br />{item.source === "mcp" ? "Через агента" : "Через форму"}</td>
                  <td className="min-w-32 px-4 py-4 text-xs">{wasReviewed(item) ? "Посмотрел автор" : "Автор ещё не отметил"}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="mx-auto w-full max-w-3xl"><SubmissionDetail key={selected.submissionId} submission={selected} submissions={submissions} feedback={feedback[selected.submissionId]} onFeedbackChange={changeFeedback} /></div>
          </div>
        ) : (
          <ol aria-label="Лента сдач" className="mx-auto grid w-full max-w-3xl gap-10">
            {rows.map((item) => <li className="min-w-0 border-b border-border pb-10" key={item.submissionId}><SubmissionDetail submission={item} submissions={submissions} feedback={feedback[item.submissionId]} onFeedbackChange={changeFeedback} /></li>)}
          </ol>
        )}
      </div>
      {/* The switcher belongs solely to the Storybook graph, including its static build. */}
      <nav aria-label="Варианты прототипа" className="fixed bottom-20 left-1/2 md:bottom-4 z-30 flex w-[min(calc(100%-2rem),24rem)] -translate-x-1/2 items-center justify-between gap-2 rounded-xl bg-primary p-2 text-primary-foreground shadow-card">
        <Button aria-label="Предыдущий вариант" className="min-h-11 min-w-11 text-primary-foreground hover:text-foreground" onClick={() => cycleVariant(-1)} variant="ghost"><ArrowLeft aria-hidden="true" /></Button>
        <span aria-live="polite" className="text-center text-xs font-medium">{variant} · {names[variant]}</span>
        <Button aria-label="Следующий вариант" className="min-h-11 min-w-11 text-primary-foreground hover:text-foreground" onClick={() => cycleVariant(1)} variant="ghost"><ArrowRight aria-hidden="true" /></Button>
      </nav>
    </main>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <label className="grid min-w-0 gap-2 text-sm font-medium">{label}{children}</label>;
}

function SubmissionDetail({ submission, submissions, feedback, onFeedbackChange }: { readonly submission: AuthorSubmission; readonly submissions: TaskSubmissions; readonly feedback: FeedbackDraft | undefined; readonly onFeedbackChange: (id: string, draft: FeedbackDraft) => void }) {
  const draft = feedback ?? {
    comment: submission.authorFeedback?.comment ?? "",
    reviewed: submission.authorFeedback !== null && submission.authorFeedback.reviewedAt !== null,
    saved: false,
    savedReviewed: submission.authorFeedback !== null && submission.authorFeedback.reviewedAt !== null,
  };
  const { comment, reviewed, saved } = draft;
  const criteria = criteriaOf(submissions, submission);
  const mark = submission.serviceMark;
  const link = repositoryLink(mark.repositoryUrl);
  return (
    <article aria-label={`Полная сдача: ${submission.task.title}`} className="grid min-w-0 content-start gap-6 [overflow-wrap:anywhere]">
      <header className="grid gap-2">
        <p className="text-xs leading-5 text-muted-foreground">{submission.task.productName} · {submission.task.chapterName}</p>
        <h2 className="text-2xl font-semibold tracking-[-0.025em]">{submission.task.title}</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <time dateTime={submission.submittedAt}>{formatSubmissionMoment(submission.submittedAt)}</time>
          <span className="inline-flex items-center gap-1">{submission.source === "mcp" ? <Bot aria-hidden="true" className="size-4" /> : <FileText aria-hidden="true" className="size-4" />}{submission.source === "mcp" ? "Через агента" : "Через форму"}</span>
          <span>Версия требований {submission.taskVersion}{submission.taskVersion === submission.task.currentVersion ? "" : ` (сейчас ${String(submission.task.currentVersion)})`}</span>
        </p>
      </header>
      <section aria-label="Данные ученика и проекта" className="grid gap-4 rounded-xl bg-secondary/60 p-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Ученик</dt><dd className="min-w-0"><span className="font-mono text-xs">{submission.person.accountId}</span><br /><span className="text-xs text-muted-foreground">{submission.person.telegramIdentityRef ?? "Telegram не привязан"}</span></dd>
          <dt className="text-muted-foreground">Заметка</dt><dd className="whitespace-pre-line leading-6">{submission.note === "" ? "Без заметки" : submission.note}</dd>
          <dt className="text-muted-foreground">Проект</dt><dd className="grid min-w-0 gap-1">
            {link === null ? (mark.repositoryUrl ?? "Репозиторий не указан") : <a className="text-action underline underline-offset-4" href={link} rel="noopener noreferrer nofollow" target="_blank">{mark.repositoryUrl}</a>}
            {mark.branch === null ? null : <span className="text-xs text-muted-foreground">Ветка: {mark.branch}</span>}
            {mark.commit === null ? null : <span className="font-mono text-xs">commit {mark.commit}</span>}
            {mark.uncommittedChanges === true ? <span className="text-xs text-muted-foreground">Есть незакоммиченные изменения</span> : null}
          </dd>
        </dl>
      </section>
      <section aria-label="Полный отчёт" className="grid gap-4">
        <div className="grid gap-1"><h3 className="text-lg font-semibold">{submission.reviewReport === null ? "Отчёт ученика" : "Отчёт агента ученика"}</h3><p className="text-xs leading-5 text-muted-foreground">Это переданный отчёт, не проверка Platform.</p></div>
        {submission.reviewReport === null ? <p className="whitespace-pre-line text-sm leading-7">{submission.reportText ?? "Отчёта проверки нет."}</p> : (
          <ol className="grid gap-5">
            {submission.reviewReport.criteria.map((item) => {
              const criterion = criteria.find((row) => row.id === item.criterionId);
              return <li className="grid gap-2 border-t border-border pt-4" key={item.criterionId}>
                <p className="flex flex-wrap items-start justify-between gap-2 text-sm"><span className="max-w-[55ch] font-semibold">{criterion === undefined ? item.criterionId : "requirement" in criterion ? criterion.requirement : criterion.task}</span><span className="rounded-md bg-secondary px-2 py-1 text-xs">{labels[item.status]}</span></p>
                <p className="text-xs text-muted-foreground">{criterion?.level === "additional" ? "Дополнительно" : "Обязательно"}{item.obtainedByRun ? " · получено запуском" : ""}</p>
                {item.evidence === "" ? null : <p className="whitespace-pre-line text-sm leading-7"><span className="font-medium">Доказательство: </span>{item.evidence}</p>}
                {item.gap === "" ? null : <p className="whitespace-pre-line text-sm leading-7"><span className="font-medium">Пробел: </span>{item.gap}</p>}
              </li>;
            })}
          </ol>
        )}
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Все критерии версии {submission.taskVersion}</summary><ul className="grid list-disc gap-3 pl-5 leading-7">{criteria.map((criterion) => <li key={criterion.id}>{"requirement" in criterion ? criterion.requirement : criterion.task}{criterion.level === "additional" ? " (дополнительно)" : " (обязательно)"}</li>)}</ul></details>
      </section>
      <form aria-label="Отзыв автора" className="grid gap-4 border-t border-border pt-6" onSubmit={(event) => { event.preventDefault(); onFeedbackChange(submission.submissionId, { ...draft, saved: true, savedReviewed: reviewed }); }}>
        <h3 className="text-lg font-semibold">Отзыв автора</h3>
        <Field label="Комментарий для ученика"><textarea className={`${fieldClass} min-h-32 resize-y py-3 leading-6`} onChange={(event) => { onFeedbackChange(submission.submissionId, { ...draft, comment: event.target.value, saved: false }); }} value={comment} /></Field>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input checked={reviewed} className="size-5 accent-primary" onChange={(event) => { onFeedbackChange(submission.submissionId, { ...draft, reviewed: event.target.checked, saved: false }); }} type="checkbox" />Посмотрел автор</label>
        <div className="flex flex-wrap items-center gap-3"><Button className="min-h-11" type="submit">Сохранить отзыв</Button><p aria-live="polite" className="text-xs text-muted-foreground">{saved ? "Отзыв сохранён в памяти прототипа. На сайт он не отправлен." : "Ученик увидит отзыв в своих сдачах после сохранения на сайте."}</p></div>
      </form>
    </article>
  );
}
