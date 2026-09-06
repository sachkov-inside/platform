"use client";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import {
  newPart,
  type Part,
  type Result,
  type Template,
} from "../model/communications";

export const fieldClass =
  "mt-2 min-h-12 w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
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
  resolveTemplate,
  disabled = false,
  label,
}: {
  parts: Part[];
  onChange: (parts: Part[]) => void;
  resolveTemplate: (reference: string) => Promise<Result<Template>>;
  disabled?: boolean;
  label: string;
}) {
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const changePart = (index: number, part: Part) => {
    onChange(parts.map((old, at) => (at === index ? part : old)));
  };
  return (
    <fieldset disabled={disabled || pending} className="min-w-0 space-y-4">
      <legend className="text-base font-semibold">{label}</legend>
      <ol className="divide-y divide-border">
        {parts.map((part, index) => (
          <li key={part.partId} className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
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
                  disabled={parts.length === 1}
                  aria-label={`Удалить часть ${String(index + 1)}`}
                  onClick={() => {
                    onChange(parts.filter((_, at) => at !== index));
                  }}
                >
                  Удалить
                </Button>
              </div>
            </div>
            {part.content.type !== "text" ? (
              <p className="text-sm text-muted-foreground">
                Медиа сохранено из Telegram. Для замены удалите часть и добавьте
                другую заготовку.
              </p>
            ) : null}
            {part.content.type !== "video_note" ? (
              <label className="block text-sm font-medium">
                {part.content.type === "text" ? "Текст сообщения" : "Подпись"}
                <textarea
                  className={`${fieldClass} min-h-28 resize-y`}
                  name={`text-${part.partId}`}
                  required={part.content.type === "text"}
                  maxLength={part.content.type === "text" ? 4096 : 1024}
                  value={part.content.text}
                  readOnly={part.content.entities.length > 0}
                  onChange={(event) => {
                    changePart(index, {
                      ...part,
                      content: { ...part.content, text: event.target.value },
                    });
                  }}
                />
              </label>
            ) : null}
            {part.content.entities.length > 0 ? (
              <div className="space-y-2 text-sm">
                <p>
                  Форматирование заготовки сохранено. Для правки текста сначала
                  явно уберите форматирование.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    changePart(index, {
                      ...part,
                      content: { ...part.content, entities: [] },
                    });
                  }}
                >
                  Редактировать без форматирования
                </Button>
              </div>
            ) : null}
            {part.content.buttons.map((button, bi) => (
              <div key={bi} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
                <label className="text-sm">
                  Текст кнопки
                  <input
                    className={fieldClass}
                    name={`button-text-${part.partId}-${String(bi)}`}
                    required
                    maxLength={64}
                    value={button.text}
                    onChange={(e) => {
                      changePart(index, {
                        ...part,
                        content: {
                          ...part.content,
                          buttons: part.content.buttons.map((b, at) =>
                            at === bi ? { ...b, text: e.target.value } : b,
                          ),
                        },
                      });
                    }}
                  />
                </label>
                <label className="min-w-0 text-sm">
                  HTTPS-ссылка
                  <input
                    className={fieldClass}
                    type="url"
                    name={`button-url-${part.partId}-${String(bi)}`}
                    required
                    value={button.url}
                    onChange={(e) => {
                      changePart(index, {
                        ...part,
                        content: {
                          ...part.content,
                          buttons: part.content.buttons.map((b, at) =>
                            at === bi ? { ...b, url: e.target.value } : b,
                          ),
                        },
                      });
                    }}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-12 sm:self-end"
                  aria-label={`Удалить кнопку ${String(bi + 1)}`}
                  onClick={() => {
                    changePart(index, {
                      ...part,
                      content: {
                        ...part.content,
                        buttons: part.content.buttons.filter(
                          (_, at) => at !== bi,
                        ),
                      },
                    });
                  }}
                >
                  Удалить
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={part.content.buttons.length >= 20}
              onClick={() => {
                changePart(index, {
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
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-12"
          disabled={parts.length >= 20}
          onClick={() => {
            onChange([...parts, newPart()]);
          }}
        >
          Добавить текстовую часть
        </Button>
      </div>
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
        <label className="text-sm font-medium">
          ID или ссылка заготовки
          <input
            className={fieldClass}
            name={`template-${label}`}
            value={reference}
            onChange={(e) => {
              setReference(e.target.value);
            }}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          className="min-h-12"
          disabled={!reference.trim() || parts.length >= 20}
          onClick={() => {
            void (async () => {
              setPending(true);
              setNotice("");
              try {
                const result = await resolveTemplate(reference.trim());
                if (result.kind === "ready") {
                  onChange([
                    ...parts,
                    {
                      partId: crypto.randomUUID(),
                      content: result.value.content,
                    },
                  ]);
                  setReference("");
                  setNotice(
                    "Заготовка добавлена снимком. Изменения исходного сообщения не изменят эту часть.",
                  );
                }
              } finally {
                setPending(false);
              }
            })();
          }}
        >
          {pending ? "Проверяем доступ…" : "Добавить заготовку"}
        </Button>
      </div>
      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {notice}
      </p>
      <p className="text-sm text-muted-foreground">
        Части отправляются по порядку как один шаг. Предпросмотр в браузере не
        отправляет сообщения.
      </p>
    </fieldset>
  );
}
