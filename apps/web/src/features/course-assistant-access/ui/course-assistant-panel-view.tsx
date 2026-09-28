import { Button } from "@/shared/ui/button";

import {
  repositoryConnectionOutcomeMessage,
  type CourseAssistantParticipant,
  type LinkableRepository,
  type RepositoryConnectionOutcome,
} from "../model/course-assistant";

export type CourseAssistantAction =
  "acknowledge" | "connect" | "repositories" | "link" | "disconnect";

export interface CourseAssistantPanelViewProps {
  readonly participant: CourseAssistantParticipant;
  readonly outcome?: RepositoryConnectionOutcome | undefined;
  /** `undefined` — список не запрашивали; пустой массив — подходящих репозиториев нет. */
  readonly repositories?: readonly LinkableRepository[] | undefined;
  readonly pending?: CourseAssistantAction | undefined;
  readonly error?: string | undefined;
  readonly onAcknowledge: () => void;
  readonly onConnect: () => void;
  readonly onShowRepositories: () => void;
  readonly onLink: (repository: LinkableRepository) => void;
  readonly onDisconnect: () => void;
}

const acknowledgedDate = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeZone: "Europe/Moscow",
});

/**
 * Temporary semantic UI for #787.
 * Replace through #798 after Storybook acceptance.
 *
 * Экран первого использования помощника курса: предупреждение о данных и Repository Link.
 */
export function CourseAssistantPanelView({
  participant,
  outcome,
  repositories,
  pending,
  error,
  onAcknowledge,
  onConnect,
  onShowRepositories,
  onLink,
  onDisconnect,
}: CourseAssistantPanelViewProps) {
  const acknowledgedAt = participant.dataNotice.acknowledgedAt;
  const link = participant.repositoryLink;
  const busy = pending !== undefined;
  const message =
    outcome === undefined
      ? undefined
      : repositoryConnectionOutcomeMessage(outcome);

  return (
    <div className="grid gap-6">
      {message === undefined ? null : (
        <p
          className={
            message.tone === "error"
              ? "rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
              : "rounded-xl border border-border bg-card p-4 text-sm leading-6"
          }
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      {error === undefined ? null : (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
          role="alert"
        >
          {error}
        </p>
      )}

      <section
        aria-labelledby="course-assistant-notice"
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h2 className="text-xl font-semibold" id="course-assistant-notice">
          Что происходит с вашими данными
        </h2>
        <ul className="mt-3 grid list-disc gap-2 pl-5 text-sm leading-6">
          <li>
            Автор курса видит все ваши чаты с помощником, результаты проверок и
            прогресс по заданиям.
          </li>
          <li>
            Чтобы проверить работу и ответить на вопросы, помощник отправляет
            код из подключённого репозитория и ваши сообщения поставщику
            языковой модели.
          </li>
          <li>
            Курс получает к репозиторию доступ только на чтение: помощник не
            может изменить ваш код.
          </li>
        </ul>
        {acknowledgedAt === null ? (
          <Button
            className="mt-5 min-h-11 px-4"
            disabled={busy}
            onClick={onAcknowledge}
            type="button"
          >
            {pending === "acknowledge" ? "Сохраняем…" : "Понятно, продолжить"}
          </Button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Вы ознакомились с предупреждением{" "}
            {acknowledgedDate.format(new Date(acknowledgedAt))}.
          </p>
        )}
      </section>

      <section
        aria-labelledby="course-assistant-repository"
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h2 className="text-xl font-semibold" id="course-assistant-repository">
          Репозиторий учебного проекта
        </h2>
        {acknowledgedAt === null ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Подключение откроется после того, как вы прочитаете предупреждение
            выше.
          </p>
        ) : link === null ? (
          <>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Установите GitHub App курса на репозиторий учебного проекта.
              Приложение просит только чтение: содержимое, pull requests и
              сведения о репозитории.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                className="min-h-11 px-4"
                disabled={busy}
                onClick={onConnect}
                type="button"
              >
                {pending === "connect"
                  ? "Переходим в GitHub…"
                  : "Подключить GitHub"}
              </Button>
              {repositories === undefined ? (
                <Button
                  className="min-h-11 px-4"
                  disabled={busy}
                  onClick={onShowRepositories}
                  type="button"
                  variant="outline"
                >
                  Выбрать из уже открытых
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6">
              Подключён{" "}
              <a
                className="font-semibold text-action underline underline-offset-4"
                href={link.repository.htmlUrl}
                rel="noreferrer"
                target="_blank"
              >
                {link.repository.fullName}
              </a>
            </p>
            <p
              className={
                link.access === "available"
                  ? "mt-1 text-sm text-muted-foreground"
                  : "mt-3 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
              }
              role={link.access === "available" ? undefined : "status"}
            >
              {link.access === "available"
                ? "Доступ на чтение действует."
                : link.access === "revoked"
                  ? "Проверка недоступна: доступ к репозиторию отозван на GitHub. Подключите репозиторий заново или выберите другой."
                  : "Не удалось узнать у GitHub, открыт ли доступ. Проверка может быть недоступна."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                className="min-h-11 px-4"
                disabled={busy}
                onClick={onShowRepositories}
                type="button"
                variant="outline"
              >
                {pending === "repositories"
                  ? "Загружаем…"
                  : "Сменить репозиторий"}
              </Button>
              <Button
                className="min-h-11 px-4"
                disabled={busy}
                onClick={onConnect}
                type="button"
                variant="outline"
              >
                {pending === "connect"
                  ? "Переходим в GitHub…"
                  : "Открыть другой репозиторий на GitHub"}
              </Button>
              <Button
                className="min-h-11 px-4"
                disabled={busy}
                onClick={onDisconnect}
                type="button"
                variant="outline"
              >
                {pending === "disconnect" ? "Отключаем…" : "Отключить"}
              </Button>
            </div>
          </>
        )}

        {acknowledgedAt !== null && repositories !== undefined ? (
          <div className="mt-6">
            <h3 className="text-base font-semibold">
              Репозитории, открытые курсу
            </h3>
            {repositories.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Пока ни одна установка GitHub App не открывает курсу
                репозиторий. Подключите GitHub.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {repositories.map((candidate) => {
                  const current =
                    link?.repository.id === candidate.repository.id &&
                    link.installationId === candidate.installationId;
                  return (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
                      key={`${String(candidate.installationId)}:${String(candidate.repository.id)}`}
                    >
                      <span className="min-w-0 break-words text-sm font-semibold">
                        {candidate.repository.fullName}
                      </span>
                      {current ? (
                        <span className="text-sm text-muted-foreground">
                          Подключён
                        </span>
                      ) : (
                        <Button
                          aria-label={`Подключить ${candidate.repository.fullName}`}
                          className="min-h-11 px-4"
                          disabled={busy}
                          onClick={() => {
                            onLink(candidate);
                          }}
                          type="button"
                          variant="outline"
                        >
                          Подключить
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
