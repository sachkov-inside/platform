"use client";
import { useState } from "react";
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
} from "../model/communications";

/** Temporary semantic UI for #309. Replace through #317 after Storybook acceptance. */
export interface BroadcastEditorProps {
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
export const fieldClass =
  "mt-1 block w-full rounded-lg border border-border bg-background p-3 text-sm";
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
  const [parts, setParts] = useState(broadcast.parts);
  const [audience, setAudience] = useState(broadcast.audience);
  const [scheduled, setScheduled] = useState(localDate(broadcast.scheduledAt));
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState(false);
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
    <section
      aria-labelledby="broadcast-editor-title"
      className="mt-6 space-y-4 rounded-xl border border-border p-4 sm:p-6"
    >
      <h2 id="broadcast-editor-title" className="text-xl font-semibold">
        Рассылка · {stateLabels[broadcast.state]}
      </h2>
      <p className="break-all text-xs text-muted-foreground">
        {broadcast.broadcastId}
      </p>
      <p>
        Получателей в снимке:{" "}
        {broadcast.audienceSnapshotId === null
          ? "ещё не определены"
          : broadcast.snapshotSize}
        .
      </p>
      <p className="text-sm text-muted-foreground">
        Состав получателей фиксируется при фактическом запуске. Поздние
        участники не добавляются; возобновление сохраняет тот же состав. Отказ
        от сообщений навсегда пропускает оставшиеся части этой рассылки.
      </p>
      {props.error || localError ? (
        <p role="alert">{localError ?? errorMessage(props.error ?? "")}</p>
      ) : null}
      <fieldset disabled={disabled || !editable} className="space-y-4">
        <legend className="font-semibold">Сообщение</legend>
        {parts.map((part, index) => (
          <div
            key={part.partId}
            className="space-y-3 rounded-lg border border-border p-3"
          >
            <h3 className="font-semibold">
              Часть {index + 1} · {mediaNames[part.content.type]}
            </h3>
            {part.content.type !== "video_note" ? (
              <label className="block text-sm">
                {part.content.type === "text" ? "Текст" : "Подпись"}
                <textarea
                  className={fieldClass}
                  value={part.content.text}
                  maxLength={part.content.type === "text" ? 4096 : 1024}
                  onChange={(event) => {
                    change(index, {
                      ...part,
                      content: {
                        ...part.content,
                        text: event.target.value,
                        entities: [],
                      },
                    });
                  }}
                />
                {part.content.entities.length ? (
                  <span>
                    Заготовка содержит форматирование. При изменении текста оно
                    будет снято; исходная заготовка сохранится.
                  </span>
                ) : null}
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
              <Button
                variant="outline"
                disabled={part.content.buttons.length >= 20}
                onClick={() => {
                  change(index, {
                    ...part,
                    content: {
                      ...part.content,
                      buttons: [...part.content.buttons, { text: "", url: "" }],
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
        <Button
          variant="outline"
          disabled={parts.length >= 20}
          onClick={() => {
            setParts((current) => [
              ...current,
              {
                partId: crypto.randomUUID(),
                content: { type: "text", text: "", entities: [], buttons: [] },
              },
            ]);
          }}
        >
          Добавить текст
        </Button>
        <label className="block">
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
          Добавить заготовку
        </Button>
        <fieldset className="space-y-2">
          <legend className="font-semibold">Аудитория</legend>
          <label className="block">
            <input
              type="radio"
              name="audience"
              checked={audience.kind === "all"}
              onChange={() => {
                setAudience({ kind: "all" });
              }}
            />{" "}
            Все контакты
          </label>
          <label className="block">
            <input
              type="radio"
              name="audience"
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
                  <label key={funnel.funnelId} className="block">
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
                Участник нескольких тем получит сообщение один раз. Отказавшиеся
                и заблокировавшие бота исключаются.
              </p>
            </div>
          ) : null}
        </fieldset>
        <label className="block">
          Время отправки · {Intl.DateTimeFormat().resolvedOptions().timeZone}
          <input
            className={fieldClass}
            type="datetime-local"
            value={scheduled}
            onChange={(event) => {
              setScheduled(event.target.value);
            }}
          />
        </label>
        <p className="text-sm">
          Пустое время — запуск сразу отдельной кнопкой. Будущая дата
          сохраняется в черновике. Кнопка «Запланировать» включает отправку;
          получатели будут определены в назначенное время.
        </p>
        <Button
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
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
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
            disabled={disabled}
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
          aria-label="Предпросмотр сообщения"
          className="space-y-3 border-t border-border pt-4"
        >
          <p className="text-sm">
            Предпросмотр ничего не отправляет. Медиа показано обозначением
            формата.
          </p>
          {parts.map((part) => (
            <article key={part.partId} className="rounded-lg bg-muted p-4">
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
                <p className="break-all text-sm" key={i}>
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
