import Link from "next/link";

import {
  criterionStatusLabels,
  practiceStatusLabels,
  reviewFailureMessages,
  reviewRefusalMessages,
  type CriterionStatus,
  type PracticeReview,
  type ReviewRefusalPart,
} from "../model/practice-review";

const statusTone: Readonly<Record<CriterionStatus, string>> = {
  confirmed: "border-emerald-600/30 bg-emerald-600/8",
  violation: "border-destructive/30 bg-destructive/6",
  not_verified: "border-amber-500/40 bg-amber-500/8",
};

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Проверка поставлена или идёт: участник видит, что именно проверяется. */
export function ReviewProgress({
  review,
}: {
  readonly review: PracticeReview;
}) {
  return (
    <div className="rounded-xl border p-4 text-sm leading-6" role="status">
      <p className="font-semibold">
        {review.state === "queued"
          ? "Проверка поставлена в очередь"
          : "Проверяю работу…"}
      </p>
      <p className="mt-1 text-muted-foreground">
        Репозиторий{" "}
        <a
          className="underline underline-offset-4"
          href={review.repository.htmlUrl}
          rel="noreferrer"
          target="_blank"
        >
          {review.repository.fullName}
        </a>
        . Помощник читает только отправленные на GitHub коммиты; незакоммиченные
        изменения ему недоступны.
      </p>
    </div>
  );
}

/** Правдоподобных вариантов работы несколько: участник выбирает, что проверять. */
export function ReviewChoice({
  review,
  onChoose,
  disabled,
}: {
  readonly review: PracticeReview;
  readonly onChoose: (candidate: {
    readonly id: string;
    readonly label: string;
  }) => void;
  readonly disabled: boolean;
}) {
  const candidates = review.candidates ?? [];
  const open = review.state === "awaiting_choice" && !disabled;
  return (
    <div className="rounded-xl border p-4 text-sm leading-6">
      <p className="font-semibold">Какую работу проверить?</p>
      <p className="mt-1 text-muted-foreground">
        В репозитории {review.repository.fullName} несколько вариантов. Помощник
        проверит один из них и не будет смешивать свидетельства разных веток.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {candidates.map((candidate) => (
          <li className="flex flex-wrap items-center gap-3" key={candidate.id}>
            <button
              className="min-h-11 rounded-lg border px-4 font-medium disabled:opacity-60"
              disabled={!open}
              onClick={() => {
                onChoose({ id: candidate.id, label: candidate.label });
              }}
              type="button"
            >
              {candidate.label}
            </button>
            <a
              className="text-muted-foreground underline underline-offset-4"
              href={candidate.url}
              rel="noreferrer"
              target="_blank"
            >
              коммит {shortSha(candidate.commitSha)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Итог Practice Review: статус, что проверено и вердикт по каждому критерию. */
export function ReviewResult({
  review,
  requirements,
  onRecheckNewVersion,
}: {
  readonly review: PracticeReview;
  readonly requirements: ReadonlyMap<string, string>;
  readonly onRecheckNewVersion?: ((contextVersion: string) => void) | undefined;
}) {
  if (review.failure !== null) {
    const current = review.failure.currentContextVersion;
    return (
      <div
        className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
        role="alert"
      >
        <p className="font-semibold">Проверка не выполнена</p>
        <p className="mt-1">{reviewFailureMessages[review.failure.code]}</p>
        {current !== null && onRecheckNewVersion !== undefined ? (
          <button
            className="mt-3 min-h-11 rounded-lg border px-4 font-medium"
            onClick={() => {
              onRecheckNewVersion(current);
            }}
            type="button"
          >
            Проверить по новой версии задания
          </button>
        ) : null}
      </div>
    );
  }
  const result = review.result;
  const checked = review.checked;
  if (result === null || checked === null) return null;
  return (
    <article
      aria-label="Итог проверки"
      className="rounded-xl border p-4 text-sm leading-6"
    >
      <p className="text-base font-semibold">
        Итог: {practiceStatusLabels[result.practiceStatus]}
        {review.kind === "recheck" ? " · повторная проверка" : ""}
      </p>
      <p className="mt-1 text-muted-foreground">
        Проверено: {checked.label}, коммит{" "}
        <a
          className="underline underline-offset-4"
          href={checked.url}
          rel="noreferrer"
          target="_blank"
        >
          {shortSha(checked.commitSha)}
        </a>
        . Версия задания {review.contextVersion.slice(0, 8)}. Незакоммиченные
        изменения не проверялись.
      </p>
      <p className="mt-3">{result.summary}</p>
      <ol className="mt-4 flex flex-col gap-3">
        {result.criteria.map((criterion) => (
          <li
            className={`rounded-lg border p-3 ${statusTone[criterion.status]}`}
            key={criterion.criterionId}
          >
            <p className="font-semibold">
              {criterionStatusLabels[criterion.status]}
              {criterion.changed && criterion.previousStatus !== null ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · было: {criterionStatusLabels[criterion.previousStatus]}
                </span>
              ) : criterion.changed ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · новый критерий
                </span>
              ) : null}
            </p>
            <p className="mt-1">
              {requirements.get(criterion.criterionId) ?? criterion.criterionId}
            </p>
            <p className="mt-2">{criterion.explanation}</p>
            {criterion.evidence.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {criterion.evidence.map((evidence) => (
                  <li key={evidence.url}>
                    <a
                      className="underline underline-offset-4"
                      href={evidence.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {evidence.path}
                      {evidence.startLine === null
                        ? ""
                        : `:${String(evidence.startLine)}${
                            evidence.endLine === null ||
                            evidence.endLine === evidence.startLine
                              ? ""
                              : `–${String(evidence.endLine)}`
                          }`}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {criterion.nextStep === null ? null : (
              <p className="mt-2">
                <span className="font-semibold">Следующий шаг: </span>
                {criterion.nextStep}
              </p>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}

/** Проверку не удалось поставить: причина и что сделать. */
export function ReviewRefusal({
  refusal,
  onRecheckNewVersion,
}: {
  readonly refusal: ReviewRefusalPart;
  readonly onRecheckNewVersion?: ((contextVersion: string) => void) | undefined;
}) {
  const needsSetup =
    refusal.code === "data_notice_required" ||
    refusal.code === "repository_link_required" ||
    refusal.code === "repository_access_revoked";
  const current = refusal.currentContextVersion;
  return (
    <div
      className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
      role="alert"
    >
      <p>{reviewRefusalMessages[refusal.code]}</p>
      {needsSetup ? (
        <Link
          className="mt-2 inline-block underline underline-offset-4"
          href="/account/course-assistant"
        >
          Открыть раздел помощника
        </Link>
      ) : null}
      {current !== null && onRecheckNewVersion !== undefined ? (
        <button
          className="mt-3 min-h-11 rounded-lg border px-4 font-medium"
          onClick={() => {
            onRecheckNewVersion(current);
          }}
          type="button"
        >
          Проверить по новой версии задания
        </button>
      ) : null}
    </div>
  );
}
