"use client";
import { cn } from "@/shared/lib/utils";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { type SavedPost, type Part } from "../model/broadcasts";
import { fieldClass } from "./communications-fields";
import styles from "./broadcasts.module.css";

export interface PostLibraryProps {
  posts: readonly SavedPost[];
  loading: boolean;
  error: string | null;
  hasNext: boolean;
  onNext: () => void;
  onRefresh: () => void;
  onSave: (post: SavedPost) => Promise<SavedPost | null>;
  onSample: (post: SavedPost) => Promise<boolean>;
}
export function PostLibrary(
  props: PostLibraryProps & {
    onChoose: (part: Part) => void;
    chooseLabel?: string | undefined;
    disabled?: boolean | undefined;
  },
) {
  const [selected, setSelected] = useState<SavedPost | null>(null);
  return (
    <section
      aria-label="Сохранённые Telegram-посты"
      className={cn(styles.template, styles.postLibrary)}
    >
      <h3 className={styles.sectionTitle}>Посты из Telegram</h3>
      <p className={styles.hint}>
        Откройте /admin в боте и создайте пост. Текст, медиа и форматирование
        сохранятся. Здесь можно настроить кнопки и выбрать пост для рассылки.
      </p>
      <Button
        variant="outline"
        disabled={props.loading}
        onClick={props.onRefresh}
      >
        Обновить посты
      </Button>
      {props.loading ? (
        <p role="status">Загружаем посты…</p>
      ) : props.error ? (
        <p role="alert">{props.error}</p>
      ) : !props.posts.length ? (
        <p>Постов пока нет. Создайте первый в Telegram.</p>
      ) : (
        <div className="grid gap-2">
          {props.posts.map((post) => (
            <Button
              key={post.templateId}
              variant={
                selected?.templateId === post.templateId
                  ? "secondary"
                  : "outline"
              }
              className="h-auto min-h-11 justify-start whitespace-normal break-words text-left"
              onClick={() => {
                setSelected(post);
              }}
            >
              {post.content.text.slice(0, 90) || post.content.type} · v
              {post.revision}
            </Button>
          ))}
        </div>
      )}
      {props.hasNext ? (
        <Button variant="outline" onClick={props.onNext}>
          Следующие посты
        </Button>
      ) : null}
      {selected ? (
        <PostDetails
          key={`${selected.templateId}:${String(selected.revision)}`}
          post={selected}
          onSave={props.onSave}
          onSample={props.onSample}
          onChoose={props.onChoose}
          chooseLabel={props.chooseLabel}
          disabled={props.disabled}
        />
      ) : null}
    </section>
  );
}
function PostDetails({
  post,
  onSave,
  onSample,
  onChoose,
  chooseLabel,
  disabled,
}: Pick<PostLibraryProps, "onSave" | "onSample"> & {
  post: SavedPost;
  onChoose: (part: Part) => void;
  chooseLabel?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const [saved, setSaved] = useState(post);
  const [buttons, setButtons] = useState(post.content.buttons);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty =
    JSON.stringify(buttons) !== JSON.stringify(saved.content.buttons);
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border p-3">
      <p className="whitespace-pre-wrap break-words">
        {saved.content.text || saved.content.type}
      </p>
      <p className={styles.hint}>
        Сохранённая версия {saved.revision}. Текст и медиа меняются через
        «Заменить сообщение» в боте. Вид сообщения проверьте образцом в
        Telegram.
      </p>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <legend className="font-medium">Кнопки поста</legend>
        {buttons.map((button, index) => (
          <div
            key={index}
            className="grid min-w-0 gap-2 rounded-lg border border-border p-3"
          >
            <label>
              Название кнопки {index + 1}
              <input
                className={fieldClass}
                maxLength={64}
                value={button.text}
                onChange={(e) => {
                  setButtons((values) =>
                    values.map((value, i) =>
                      i === index ? { ...value, text: e.target.value } : value,
                    ),
                  );
                }}
              />
            </label>
            <label>
              Ссылка кнопки {index + 1}
              <input
                className={fieldClass}
                type="url"
                value={button.url}
                onChange={(e) => {
                  setButtons((values) =>
                    values.map((value, i) =>
                      i === index ? { ...value, url: e.target.value } : value,
                    ),
                  );
                }}
              />
            </label>
            <label>
              Ряд кнопки {index + 1}
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={20}
                value={(button.row ?? index) + 1}
                onChange={(e) => {
                  setButtons((values) =>
                    values.map((value, i) =>
                      i === index
                        ? { ...value, row: Number(e.target.value) - 1 }
                        : value,
                    ),
                  );
                }}
              />
            </label>
            <Button
              variant="outline"
              onClick={() => {
                setButtons((values) => values.filter((_, i) => i !== index));
              }}
            >
              Удалить кнопку {index + 1}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={buttons.length >= 20}
            onClick={() => {
              setButtons((values) => [
                ...values,
                { text: "", url: "", row: Math.min(values.length, 19) },
              ]);
            }}
          >
            Добавить кнопку поста
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => {
              void (async () => {
                setPending(true);
                setMessage(null);
                try {
                  const result = await onSave({
                    ...saved,
                    content: { ...saved.content, buttons },
                  });
                  if (result) {
                    setSaved(result);
                    setButtons(result.content.buttons);
                    setMessage(
                      "Пост сохранён. Уже выбранные части рассылки не изменились.",
                    );
                  } else
                    setMessage(
                      "Не удалось сохранить. Проверьте кнопки и обновите пост при конфликте версий.",
                    );
                } finally {
                  setPending(false);
                }
              })();
            }}
          >
            Сохранить пост
          </Button>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending || dirty}
          onClick={() => {
            void (async () => {
              setPending(true);
              try {
                setMessage(
                  (await onSample(saved))
                    ? "Образец поставлен в очередь только вам в Telegram."
                    : "Не удалось отправить образец. Обновите пост и проверьте доступ.",
                );
              } finally {
                setPending(false);
              }
            })();
          }}
        >
          Образец себе
        </Button>
        <Button
          disabled={pending || dirty || disabled}
          onClick={() => {
            onChoose({ partId: crypto.randomUUID(), content: saved.content });
          }}
        >
          {chooseLabel ?? "Добавить в рассылку"}
        </Button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
