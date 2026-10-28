import type {
  AuthorSubmission,
  FeedbackFilter,
  FilterProduct,
  SubmissionSelection,
} from "./task-submissions";

/** A choice of a filter select; `all` is the «not chosen» value, as a select needs a value. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export const allChoice = "all";

export const feedbackOptions: readonly (FilterOption & {
  readonly value: FeedbackFilter;
})[] = [
  { value: "awaiting", label: "Без комментария" },
  { value: "given", label: "С комментарием" },
  { value: "all", label: "Все сдачи" },
];

export function productOptions(
  products: readonly FilterProduct[],
): readonly FilterOption[] {
  return [
    { value: allChoice, label: "Все продукты" },
    ...products.map((product) => ({ value: product.id, label: product.name })),
  ];
}

const chapterPrefix = "chapter:";
const taskPrefix = "task:";

/**
 * One select for a chapter or a task (#1717): the filter bar holds three selects, so the chapter
 * level of the former «Продукт, глава, задание» form joins the task select. A chapter is offered
 * only inside a chosen Product, as before; without one, every task of the Products on offer is.
 */
export function taskOptions(
  products: readonly FilterProduct[],
  selection: SubmissionSelection,
): readonly FilterOption[] {
  const product = products.find((item) => item.id === selection.productId);
  const seen = new Set<string>();
  const tasks = (chapter: FilterProduct["chapters"][number]) =>
    chapter.tasks.flatMap((task) => {
      if (seen.has(task.code)) return [];
      seen.add(task.code);
      return [{ value: `${taskPrefix}${task.code}`, label: task.title }];
    });
  return [
    { value: allChoice, label: "Все задания" },
    ...(product === undefined
      ? products.flatMap((item) => item.chapters.flatMap(tasks))
      : product.chapters.flatMap((chapter) => [
          {
            value: `${chapterPrefix}${chapter.id}`,
            label: `${chapter.name}: все задания`,
          },
          ...tasks(chapter),
        ])),
  ];
}

export function taskValue(selection: SubmissionSelection): string {
  if (selection.taskCode !== undefined)
    return `${taskPrefix}${selection.taskCode}`;
  if (selection.chapterId !== undefined)
    return `${chapterPrefix}${selection.chapterId}`;
  return allChoice;
}

/** The selection after a chapter or task choice; the chosen Product stays. */
export function selectionForTask(
  selection: SubmissionSelection,
  value: string,
): SubmissionSelection {
  const product =
    selection.productId === undefined ? {} : { productId: selection.productId };
  if (value.startsWith(chapterPrefix))
    return { ...product, chapterId: value.slice(chapterPrefix.length) };
  if (value.startsWith(taskPrefix))
    return { ...product, taskCode: value.slice(taskPrefix.length) };
  return product;
}

/** A new Product choice drops the chapter and task of the previous one. */
export function selectionForProduct(value: string): SubmissionSelection {
  return value === allChoice ? {} : { productId: value };
}

/** Labels of the applied server filters for their chips; an unknown value has no chip. */
export function selectionLabels(
  selection: SubmissionSelection,
  products: readonly FilterProduct[],
): { readonly product?: string; readonly task?: string } {
  const product = products.find((item) => item.id === selection.productId);
  const chapters =
    product?.chapters ?? products.flatMap((item) => item.chapters);
  const chapter = product?.chapters.find(
    (item) => item.id === selection.chapterId,
  );
  const task = chapters
    .flatMap((item) => item.tasks)
    .find((item) => item.code === selection.taskCode);
  const taskLabel = task?.title ?? chapter?.name;
  return {
    ...(product === undefined ? {} : { product: product.name }),
    ...(taskLabel === undefined ? {} : { task: taskLabel }),
  };
}

/** The person as the list names them: profile name, then Telegram username. Never an email. */
export function personName(submission: AuthorSubmission): string {
  return (
    submission.person.displayName ??
    (submission.person.telegramUsername === null
      ? "Имя не указано"
      : `@${submission.person.telegramUsername}`)
  );
}

export function contactLabel(submission: AuthorSubmission): string {
  if (submission.person.telegramUsername !== null)
    return `@${submission.person.telegramUsername}`;
  return submission.person.telegramContactState === "not_linked"
    ? "Telegram не привязан"
    : submission.person.telegramContactState === "available"
      ? "В Telegram нет username"
      : "Контакт Telegram недоступен";
}

/** The contact line of a list row: a username already shown as the name is not repeated. */
export function contactCaption(submission: AuthorSubmission): string {
  return submission.person.displayName === null &&
    submission.person.telegramUsername !== null
    ? "Имя в профиле не указано"
    : contactLabel(submission);
}

export const selfCheckOutcomes = {
  passed: "Самопроверка пройдена",
  changes: "Нужны исправления",
  missing: "Не хватает подтверждений",
  none: "Без самопроверки",
} as const;
export type SelfCheckOutcome = keyof typeof selfCheckOutcomes;

/** The self-check under the list state: «Нужны исправления, попытка 2». */
export function selfCheckLine(submission: AuthorSubmission): string {
  const check = submission.selfCheck;
  return check === null
    ? selfCheckOutcomes.none
    : `${selfCheckOutcomes[check.outcome]}, попытка ${String(check.attempt)}`;
}

/** «Версия 1» and, for an earlier version than the task has now, «Сейчас 2». */
export function versionLines(submission: AuthorSubmission): {
  readonly version: string;
  readonly current: string | null;
} {
  return {
    version: `Версия ${String(submission.taskVersion)}`,
    current:
      submission.taskVersion < submission.task.currentVersion
        ? `Сейчас ${String(submission.task.currentVersion)}`
        : null,
  };
}

/** «AI Engineering · Глава 1. Онбординг» under the task title. */
export function productLine(submission: AuthorSubmission): string {
  return `${submission.task.productName ?? "Продукт не найден"} · ${submission.task.chapterName ?? "Глава удалена"}`;
}
