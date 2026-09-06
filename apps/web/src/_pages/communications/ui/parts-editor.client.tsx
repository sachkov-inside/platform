"use client";
import { useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import type { Part } from "../model/communications";

export { fieldClass } from "./communications-fields";
const types = {
  text: "Текст",
  photo: "Фото",
  video: "Видео",
  video_note: "Кружок",
  voice: "Голосовое сообщение",
  document: "Документ",
};
export function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const next = [...items];
  const item = next[index];
  if (item === undefined || index + offset < 0 || index + offset >= next.length)
    return items;
  next.splice(index, 1);
  next.splice(index + offset, 0, item);
  return next;
}
export function PartsEditor({
  parts,
  onChange,
  renderLibrary,
  disabled = false,
  label,
  maxParts = 20,
}: {
  parts: Part[];
  onChange: (parts: Part[]) => void;
  renderLibrary: (
    choose: (part: Part) => void,
    chooseLabel: string,
  ) => ReactNode;
  disabled?: boolean;
  label: string;
  maxParts?: number;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="text-base font-semibold">{label}</legend>
      <p className="text-sm text-muted-foreground">
        Подготовьте текст, медиа и оформление в Telegram. Здесь соберите порядок
        сохранённых постов.
      </p>
      <ol className="space-y-4">
        {parts.map((part, index) => (
          <li
            key={part.partId}
            className="min-w-0 space-y-4 rounded-lg border border-border bg-background p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-semibold">
                Часть {index + 1} · {types[part.content.type]}
              </p>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={index === 0}
                  aria-label={`Часть ${String(index + 1)}: выше`}
                  onClick={() => {
                    onChange(moveItem(parts, index, -1));
                  }}
                >
                  Выше
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={index === parts.length - 1}
                  aria-label={`Часть ${String(index + 1)}: ниже`}
                  onClick={() => {
                    onChange(moveItem(parts, index, 1));
                  }}
                >
                  Ниже
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  aria-label={`Удалить часть ${String(index + 1)}`}
                  onClick={() => {
                    onChange(parts.filter((_, at) => at !== index));
                    if (choosing === part.partId) setChoosing(null);
                  }}
                >
                  Удалить
                </Button>
              </div>
            </div>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {part.content.text ||
                `Сохранено из Telegram: ${types[part.content.type]}`}
            </p>
            {part.content.entities.length ? (
              <p className="text-sm text-muted-foreground">
                Форматирование Telegram сохранено. Точный вид можно проверить
                образцом в боте.
              </p>
            ) : null}
            {part.content.buttons.length ? (
              <div aria-label="Кнопки сообщения" className="space-y-2">
                {Array.from(
                  new Set(
                    part.content.buttons.map((button, i) => button.row ?? i),
                  ),
                )
                  .sort((a, b) => a - b)
                  .map((row) => (
                    <div key={row} className="flex flex-wrap gap-2">
                      {part.content.buttons
                        .filter((button, i) => (button.row ?? i) === row)
                        .map((button, i) => (
                          <a
                            key={i}
                            href={button.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-11 min-w-0 items-center rounded-lg border border-border px-3 py-2 text-sm break-words [overflow-wrap:anywhere]"
                          >
                            {button.text}
                          </a>
                        ))}
                    </div>
                  ))}
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setChoosing(part.partId);
              }}
              aria-label={`Заменить часть ${String(index + 1)} из сохранённых постов`}
            >
              Заменить из сохранённых постов
            </Button>
          </li>
        ))}
      </ol>
      {!parts.length ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Сообщений пока нет. Выберите первый сохранённый пост.
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="min-h-12"
        disabled={parts.length >= maxParts}
        onClick={() => {
          setChoosing("new");
        }}
      >
        Добавить сохранённый пост
      </Button>
      {choosing ? (
        <div className="min-w-0 space-y-3 rounded-xl border border-border p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {choosing === "new"
                ? "Новое сообщение"
                : "Замена выбранной части"}
            </p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setChoosing(null);
              }}
            >
              Закрыть выбор
            </Button>
          </div>
          {renderLibrary(
            (part) => {
              if (disabled) return;
              onChange(
                choosing === "new"
                  ? [...parts, part]
                  : parts.map((prior) =>
                      prior.partId === choosing
                        ? { ...prior, content: part.content }
                        : prior,
                    ),
              );
              setNotice(
                choosing === "new"
                  ? "Пост добавлен. Сохраните изменения воронки."
                  : "Выбранное содержимое заменено. Идентификатор части сохранён.",
              );
              setChoosing(null);
            },
            choosing === "new"
              ? "Добавить в последовательность"
              : "Заменить выбранную часть",
          )}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Изменение исходного поста не меняет уже выбранную часть. Чтобы применить
        новую версию, замените её явно.
      </p>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
    </fieldset>
  );
}
