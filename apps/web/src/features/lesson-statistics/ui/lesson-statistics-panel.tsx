import type { LessonRatingCounts } from "../model/lesson-statistics-contract";
import type {
  ExerciseStatisticsView,
  ExerciseVersionView,
} from "../model/lesson-statistics-view";

export type LessonStatisticsState =
  | { readonly kind: "loading" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "ready";
      readonly exercises: readonly ExerciseStatisticsView[];
      readonly ratings: LessonRatingCounts;
    };

const dayFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Moscow",
});

/**
 * Author statistics of one lesson (#2124): likes and dislikes, then for each exercise and each of
 * its versions the respondents, the first-try correct share and the most frequent wrong answer.
 */
export function LessonStatisticsPanel({
  state,
}: {
  readonly state: LessonStatisticsState;
}) {
  return (
    <section
      aria-labelledby="lesson-statistics-heading"
      className="min-w-0"
      data-lesson-statistics
    >
      <h2 className="text-sm font-semibold" id="lesson-statistics-heading">
        Статистика урока
      </h2>
      {state.kind === "loading" ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Загружаем статистику…
        </p>
      ) : state.kind === "forbidden" ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Статистика доступна только тем, кто управляет материалами.
        </p>
      ) : state.kind === "unavailable" ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Статистика сейчас недоступна.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm" data-lesson-statistics-ratings>
            «Как вам урок?»: понравился {state.ratings.likes}, не понравился{" "}
            {state.ratings.dislikes}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Счёт ведётся по первой попытке каждого человека на версию
            упражнения.
          </p>
          {state.exercises.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              В уроке нет упражнений.
            </p>
          ) : (
            <ol className="mt-4 grid gap-4">
              {state.exercises.map((exercise) => (
                <li
                  className="rounded-xl border border-border p-3 sm:p-4"
                  data-lesson-statistics-exercise={exercise.exerciseId}
                  key={exercise.exerciseId}
                >
                  <h3 className="text-sm font-semibold">{exercise.title}</h3>
                  <p className="mt-1 text-sm break-words text-muted-foreground">
                    {exercise.question}
                  </p>
                  {exercise.versions.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Пока никто не ответил.
                    </p>
                  ) : (
                    <ul className="mt-3 grid gap-3">
                      {exercise.versions.map((version) => (
                        <VersionRow
                          key={version.fingerprint}
                          version={version}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function VersionRow({ version }: { readonly version: ExerciseVersionView }) {
  return (
    <li
      className="grid gap-1 text-sm"
      data-lesson-statistics-version={version.fingerprint}
    >
      <p className="font-medium">
        {version.current ? "Текущая версия" : "Прежняя версия"}
        <span className="font-normal text-muted-foreground">
          {" "}
          · ответы с {dayFormat.format(new Date(version.firstAnsweredAt))}
        </span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Ответили</dt>
        <dd className="tabular-nums">{version.respondents}</dd>
        <dt className="text-muted-foreground">Верно с первой попытки</dt>
        <dd className="tabular-nums">{version.firstTryCorrectPercent}%</dd>
        {version.firstTryDontKnow === 0 ? null : (
          <>
            <dt className="text-muted-foreground">«Не знаю» сразу</dt>
            <dd className="tabular-nums">{version.firstTryDontKnow}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Частый неверный ответ</dt>
        <dd className="min-w-0 break-words">
          {version.mostFrequentWrong === null
            ? "нет"
            : `${version.mostFrequentWrong.text} (${String(version.mostFrequentWrong.count)})`}
        </dd>
      </dl>
    </li>
  );
}
