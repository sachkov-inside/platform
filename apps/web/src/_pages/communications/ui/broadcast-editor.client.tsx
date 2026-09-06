"use client";
import { PostLibrary, type PostLibraryProps } from "./post-library.client";
import { useId, useState } from "react";
import { BroadcastStatus } from "./broadcast-status";
import styles from "./broadcasts.module.css";
import { Button } from "@/shared/ui/button";
import {
  type Broadcast,
  type BroadcastResult,
  type Funnel,
  type Part,
  type SaveBroadcastInput,
  type BroadcastActionInput,
  stateLabels,
  errorMessage,
} from "../model/broadcasts";

export interface BroadcastEditorProps {
  readonly library?: PostLibraryProps;
  readonly broadcast: Broadcast;
  readonly funnels: readonly Funnel[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSave: (input: SaveBroadcastInput) => void;
  readonly onLaunch: (input: BroadcastActionInput) => void;
  readonly onPause: (input: BroadcastActionInput) => void;
  readonly onResume: (input: BroadcastActionInput) => void;
  readonly onCancel: (input: BroadcastActionInput) => void;
  readonly onRefresh: () => void;
  readonly onTemplate: (reference: string) => Promise<Part | null>;
}
import { fieldClass } from "./communications-fields";
export { fieldClass } from "./communications-fields";
const mediaNames = {
  text: "Текст",
  photo: "Фото",
  video: "Видео",
  video_note: "Кружок",
  voice: "Голосовое",
  document: "Документ",
};
function localDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(+date - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function BroadcastEditor(props: BroadcastEditorProps) {
  const { broadcast, pending, funnels } = props;
  const editorId = useId();
  const [parts, setParts] = useState(broadcast.parts);
  const [audience, setAudience] = useState(broadcast.audience);
  const [scheduled, setScheduled] = useState(localDate(broadcast.scheduledAt));
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState(false);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const editable =
    ["draft", "scheduled", "paused"].includes(broadcast.state) &&
    broadcast.audienceSnapshotId === null;
  const scheduledAt =
    scheduled === localDate(broadcast.scheduledAt)
      ? broadcast.scheduledAt
      : scheduled
        ? new Date(scheduled).toISOString()
        : null;
  const dirty =
    JSON.stringify(parts) !== JSON.stringify(broadcast.parts) ||
    JSON.stringify(audience) !== JSON.stringify(broadcast.audience) ||
    scheduledAt !== broadcast.scheduledAt;
  const disabled =
    pending ||
    importing ||
    [
      "provider_unavailable",
      "provider_invalid_response",
      "invalid_response",
      "revision_conflict",
      "operation_conflict",
    ].includes(props.error ?? "");
  function action(): BroadcastActionInput {
    return {
      operationId: crypto.randomUUID(),
      expectedRevision: broadcast.revision,
      payload: { broadcastId: broadcast.broadcastId },
    };
  }
  function change(index: number, part: Part) {
    setParts((current) =>
      current.map((value, i) => (i === index ? part : value)),
    );
  }
  return (
    <section aria-labelledby={`${editorId}-title`} className={styles.editor}>
      <header className={styles.editorHeader}>
        <div>
          <p className={styles.eyebrow}>Разовое сообщение</p>
          <h2 id={`${editorId}-title`} className="text-xl font-semibold">
            Рассылка{" "}
            <span className="sr-only">· {stateLabels[broadcast.state]}</span>
          </h2>
        </div>
        <BroadcastStatus state={broadcast.state} />
      </header>
      <details className={styles.identifier}>
        <summary>ID рассылки</summary>
        <p className="break-all font-mono text-xs">{broadcast.broadcastId}</p>
      </details>
      {props.error || localError ? (
        <p role="alert" className={styles.alert}>
          {localError ?? errorMessage(props.error ?? "")}
        </p>
      ) : null}
      <fieldset
        disabled={disabled || !editable}
        className={styles.editorFields}
      >
        <legend className="sr-only">Редактирование рассылки</legend>
        <div className={styles.messageColumn}>
          <h3 className={styles.sectionTitle}>Сообщение</h3>
          <p className={styles.hint}>
            Выберите готовые посты из Telegram. Части отправятся по порядку.
            Рассылка сохраняет свою версию: правка исходного поста её не меняет.
          </p>
          {props.library ? (
            <PostLibrary
              {...props.library}
              disabled={
                !editable ||
                disabled ||
                (replaceIndex === null && parts.length >= 20)
              }
              chooseLabel={
                replaceIndex === null
                  ? "Добавить в рассылку"
                  : `Заменить часть ${String(replaceIndex + 1)}`
              }
              onChoose={(part) => {
                setParts((current) =>
                  replaceIndex !== null
                    ? current.map((value, i) =>
                        i === replaceIndex
                          ? { ...part, partId: value.partId }
                          : value,
                      )
                    : current.length === 1 &&
                        !current[0]?.content.text &&
                        current[0]?.content.type === "text"
                      ? [part]
                      : [...current, part],
                );
                setReplaceIndex(null);
              }}
            />
          ) : null}
          {parts.map((part, index) => (
            <div key={part.partId} className={styles.part}>
              <h3 className="font-semibold">
                Часть {index + 1} · {mediaNames[part.content.type]}
              </h3>
              {part.content.type !== "video_note" ? (
                <label className="block text-sm">
                  {part.content.type === "text" ? "Текст" : "Подпись"}
                  <textarea
                    aria-label={
                      part.content.type === "text" ? "Текст" : "Подпись"
                    }
                    className={fieldClass}
                    rows={6}
                    value={part.content.text}
                    maxLength={part.content.type === "text" ? 4096 : 1024}
                    readOnly
                  />
                  <span className={styles.hint}>
                    Текст и оформление сохранены из Telegram. Для правки
                    замените часть готовым постом.
                  </span>
                </label>
              ) : (
                <p>
                  Медиа сохранено в Telegram. Для замены добавьте другую
                  заготовку.
                </p>
              )}
              {part.content.buttons.map((button, buttonIndex) => (
                <div key={buttonIndex} className="grid gap-2 sm:grid-cols-2">
                  <label>
                    Текст кнопки
                    <input
                      className={fieldClass}
                      value={button.text}
                      maxLength={64}
                      onChange={(event) => {
                        change(index, {
                          ...part,
                          content: {
                            ...part.content,
                            buttons: part.content.buttons.map((b, i) =>
                              i === buttonIndex
                                ? { ...b, text: event.target.value }
                                : b,
                            ),
                          },
                        });
                      }}
                    />
                  </label>
                  <label>
                    Адрес кнопки
                    <input
                      type="url"
                      className={fieldClass}
                      value={button.url}
                      onChange={(event) => {
                        change(index, {
                          ...part,
                          content: {
                            ...part.content,
                            buttons: part.content.buttons.map((b, i) =>
                              i === buttonIndex
                                ? { ...b, url: event.target.value }
                                : b,
                            ),
                          },
                        });
                      }}
                    />
                  </label>
                  <label>
                    Ряд кнопки
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className={fieldClass}
                      value={(button.row ?? buttonIndex) + 1}
                      onChange={(event) => {
                        change(index, {
                          ...part,
                          content: {
                            ...part.content,
                            buttons: part.content.buttons.map((b, i) =>
                              i === buttonIndex
                                ? { ...b, row: Number(event.target.value) - 1 }
                                : b,
                            ),
                          },
                        });
                      }}
                    />
                  </label>
                  <Button
                    variant="outline"
                    onClick={() => {
                      change(index, {
                        ...part,
                        content: {
                          ...part.content,
                          buttons: part.content.buttons.filter(
                            (_, i) => i !== buttonIndex,
                          ),
                        },
                      });
                    }}
                  >
                    Удалить кнопку {buttonIndex + 1}
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {props.library ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReplaceIndex(index);
                    }}
                  >
                    Заменить часть {index + 1}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  disabled={part.content.buttons.length >= 20}
                  onClick={() => {
                    change(index, {
                      ...part,
                      content: {
                        ...part.content,
                        buttons: [
                          ...part.content.buttons,
                          { text: "", url: "" },
                        ],
                      },
                    });
                  }}
                >
                  Добавить кнопку
                </Button>
                <Button
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => {
                    setParts((current) => {
                      const next = [...current];
                      const part = next[index];
                      const previous = next[index - 1];
                      if (part && previous) {
                        next[index - 1] = part;
                        next[index] = previous;
                      }
                      return next;
                    });
                  }}
                >
                  Выше
                </Button>
                <Button
                  variant="outline"
                  disabled={parts.length === 1}
                  onClick={() => {
                    setParts((current) =>
                      current.filter((p) => p.partId !== part.partId),
                    );
                  }}
                >
                  Удалить часть
                </Button>
              </div>
            </div>
          ))}
          <details className={styles.template}>
            <summary>Добавить пост по ID или ссылке</summary>
            <label className="block text-sm font-medium">
              ID или ссылка заготовки
              <input
                className={fieldClass}
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                }}
              />
            </label>
            <Button
              variant="outline"
              disabled={!reference || parts.length >= 20}
              onClick={() => {
                void (async () => {
                  setImporting(true);
                  setLocalError(null);
                  try {
                    const part = await props.onTemplate(reference);
                    if (part) {
                      setParts((current) =>
                        current.length === 1 &&
                        current[0]?.content.type === "text" &&
                        !current[0].content.text &&
                        !current[0].content.buttons.length
                          ? [part]
                          : [...current, part],
                      );
                      setReference("");
                    } else
                      setLocalError(
                        "Не удалось загрузить заготовку. Проверьте ссылку и доступ.",
                      );
                  } finally {
                    setImporting(false);
                  }
                })();
              }}
            >
              {importing ? "Загружаем заготовку…" : "Добавить заготовку"}
            </Button>
          </details>
        </div>
        <div className={styles.settingsColumn}>
          <fieldset className={styles.audience}>
            <legend className={styles.sectionTitle}>Аудитория</legend>
            <label className={styles.choice}>
              <input
                type="radio"
                name={`${editorId}-audience`}
                checked={audience.kind === "all"}
                onChange={() => {
                  setAudience({ kind: "all" });
                }}
              />{" "}
              Все контакты
            </label>
            <label className={styles.choice}>
              <input
                type="radio"
                name={`${editorId}-audience`}
                checked={audience.kind === "funnels"}
                onChange={() => {
                  setAudience({ kind: "funnels", funnelIds: [] });
                }}
              />{" "}
              Участники выбранных воронок
            </label>
            {audience.kind === "funnels" ? (
              <div className="space-y-2 pl-4">
                {funnels.length ? (
                  funnels.map((funnel) => (
                    <label key={funnel.funnelId} className={styles.choice}>
                      <input
                        type="checkbox"
                        checked={audience.funnelIds.includes(funnel.funnelId)}
                        onChange={(event) => {
                          setAudience({
                            kind: "funnels",
                            funnelIds: event.target.checked
                              ? [...audience.funnelIds, funnel.funnelId]
                              : audience.funnelIds.filter(
                                  (id) => id !== funnel.funnelId,
                                ),
                          });
                        }}
                      />{" "}
                      {funnel.name}
                    </label>
                  ))
                ) : (
                  <p>Сначала создайте воронку.</p>
                )}
                <p className="text-sm">
                  Участник нескольких тем получит сообщение один раз.
                  Отказавшиеся и заблокировавшие бота исключаются.
                </p>
              </div>
            ) : null}
          </fieldset>
          <div className={styles.schedule}>
            <label className="block text-sm font-semibold">
              Время отправки ·{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
              <input
                className={fieldClass}
                type="datetime-local"
                value={scheduled}
                onChange={(event) => {
                  setScheduled(event.target.value);
                }}
              />
            </label>
            <p className={styles.hint}>
              Пустое время — запуск сразу отдельной кнопкой. Будущая дата
              сохраняется в черновике. Кнопка «Запланировать» включает отправку;
              получатели будут определены в назначенное время.
            </p>
          </div>
          <div className={styles.snapshot}>
            <p className="font-semibold text-sm">
              Получателей в снимке:{" "}
              {broadcast.audienceSnapshotId === null
                ? "ещё не определены"
                : broadcast.snapshotSize}
              .
            </p>
            <p className={styles.hint}>
              Состав получателей фиксируется при фактическом запуске. Поздние
              участники не добавляются; возобновление сохраняет тот же состав.
              Отказ от сообщений навсегда пропускает оставшиеся части этой
              рассылки.
            </p>
          </div>
          <Button
            className="w-full min-h-11"
            onClick={() => {
              setLocalError(null);
              if (
                scheduledAt &&
                scheduled !== localDate(broadcast.scheduledAt) &&
                +new Date(scheduledAt) <= Date.now()
              ) {
                setLocalError("Выберите будущее время.");
                return;
              }
              props.onSave({
                ...action(),
                payload: {
                  broadcastId: broadcast.broadcastId,
                  parts,
                  audience,
                  scheduledAt,
                },
              });
            }}
          >
            Сохранить черновик
          </Button>
          <p role="status" className={styles.saveStatus}>
            {pending
              ? "Сохраняем результат операции…"
              : dirty
                ? "Есть несохранённые изменения"
                : editable
                  ? "Запуск — отдельным действием после сохранения"
                  : "Содержание и состав получателей зафиксированы"}
          </p>
        </div>
      </fieldset>
      <div className={styles.lifecycle}>
        <Button
          variant="outline"
          aria-expanded={preview}
          aria-controls={`${editorId}-preview`}
          onClick={() => {
            setPreview((value) => !value);
          }}
        >
          {preview ? "Скрыть предпросмотр" : "Предпросмотр"}
        </Button>
        <Button
          variant="outline"
          disabled={pending || importing}
          onClick={props.onRefresh}
        >
          Загрузить актуальную рассылку
        </Button>
        {editable ? (
          <Button
            disabled={
              disabled ||
              dirty ||
              broadcast.revision === 0 ||
              broadcast.state !== "draft"
            }
            onClick={() => {
              props.onLaunch(action());
            }}
          >
            {broadcast.scheduledAt ? "Запланировать" : "Запустить сейчас"}
          </Button>
        ) : null}
        {["running", "scheduled"].includes(broadcast.state) ? (
          <Button
            disabled={disabled}
            onClick={() => {
              props.onPause(action());
            }}
          >
            Пауза
          </Button>
        ) : null}
        {broadcast.state === "paused" ? (
          <Button
            disabled={disabled || dirty}
            onClick={() => {
              props.onResume(action());
            }}
          >
            Возобновить
          </Button>
        ) : null}
        {!["cancelled", "completed"].includes(broadcast.state) &&
        broadcast.revision > 0 ? (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              props.onCancel(action());
            }}
          >
            Отменить рассылку
          </Button>
        ) : null}
      </div>
      {preview ? (
        <section
          id={`${editorId}-preview`}
          aria-label="Предпросмотр сообщения"
          className={styles.preview}
        >
          <h3 className={styles.sectionTitle}>Предпросмотр сообщения</h3>
          <p className={styles.hint}>
            Предпросмотр ничего не отправляет. Медиа показано обозначением
            формата.
          </p>
          {parts.map((part) => (
            <article key={part.partId} className={styles.previewMessage}>
              <p className="font-semibold">{mediaNames[part.content.type]}</p>
              <p className="whitespace-pre-wrap break-words">
                {part.content.text}
              </p>
              {part.content.entities.length ? (
                <p className="text-sm">
                  Форматирование заготовки сохранено (
                  {part.content.entities.length} фрагментов).
                </p>
              ) : null}
              {part.content.buttons.map((button, i) => (
                <p className={styles.previewButton} key={i}>
                  {button.text} · {button.url}
                </p>
              ))}
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
export function applyBroadcastResult(
  result: BroadcastResult,
  onReady: (broadcast: Broadcast) => void,
  onError: (code: string | null) => void,
) {
  if (result.kind === "ready") {
    onError(null);
    onReady(result.broadcast);
  } else onError(result.code);
}
