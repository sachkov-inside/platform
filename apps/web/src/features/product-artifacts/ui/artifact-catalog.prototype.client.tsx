"use client";

import {
  ArrowRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Lock,
  Search,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

/** Throwaway Storybook proof for #1378; never imported by a production route. */
export interface ArtifactProofResource {
  readonly id: string;
  readonly name: string;
  readonly kind: "text" | "file" | "link";
  readonly text?: string;
  readonly href?: string;
  readonly filename?: string;
  readonly prompt?: string;
}

export interface ArtifactProofItem {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly category: "Промпт" | "Скилл" | "Инструмент" | "Файл";
  readonly updated: string;
  readonly resources: readonly ArtifactProofResource[];
  readonly bundleHref?: string;
  readonly locked?: boolean;
}

/** Compact resource catalog; its course shell is supplied by the story adapter. */
export function ArtifactCatalogProof({
  artifacts,
  context = "catalog",
  status = "ready",
}: {
  readonly artifacts: readonly ArtifactProofItem[];
  readonly context?: "catalog" | "lesson";
  readonly status?: "ready" | "loading" | "error";
}) {
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<ArtifactProofItem | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const visible = artifacts.filter((artifact) =>
    `${artifact.title} ${artifact.purpose} ${artifact.resources.map((resource) => resource.name).join(" ")}`
      .toLocaleLowerCase("ru")
      .includes(search.toLocaleLowerCase("ru")),
  );

  function open(artifact: ArtifactProofItem, button: HTMLButtonElement) {
    opener.current = button;
    setOpened(artifact);
  }

  return (
    <div className="min-w-0 py-5">
      {context === "lesson" ? (
        <article className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight">
            Как разобраться в чужом проекте
          </h1>
          <p className="mt-6 text-base leading-8">
            Начните с устройства проекта. Найдите точку входа, основные модули и
            проверки. Попросите агента объяснить связи между ними и подтвердить
            выводы ссылками на код.
          </p>
          <p className="mt-5 text-base leading-8">
            Используйте готовый промпт. Его можно прочитать здесь, скопировать
            или скачать, не уходя из урока.
          </p>
          {artifacts[0] === undefined ? null : (
            <button
              type="button"
              onClick={(event) => {
                if (artifacts[0] !== undefined)
                  open(artifacts[0], event.currentTarget);
              }}
              className="mt-5 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg bg-muted px-3 py-2 text-left text-sm font-medium hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            >
              <FileText aria-hidden="true" className="size-4 shrink-0" />
              {artifacts[0].title}
              <span className="sr-only"> — открыть артефакт</span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </button>
          )}
          <h2 className="mt-10 text-xl font-semibold">Проверьте результат</h2>
          <p className="mt-4 leading-8">
            Вы должны понимать, где проект принимает запросы, хранит данные и
            проверяет изменения. После просмотра артефакта продолжите чтение с
            этого места.
          </p>
        </article>
      ) : (
        <section aria-label="Артефакты курса">
          <div className="mb-4 flex justify-end">
            <label className="relative block w-full sm:w-64">
              <span className="sr-only">Найти артефакт</span>
              <Search
                aria-hidden="true"
                className="absolute left-3 top-3 size-4 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                placeholder="Найти артефакт"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>
          {status === "loading" ? (
            <p role="status" className="py-8 text-sm text-muted-foreground">
              Загружаем артефакты…
            </p>
          ) : status === "error" ? (
            <div role="alert" className="py-8 text-sm">
              <h3 className="font-semibold">Не удалось загрузить артефакты</h3>
              <p className="mt-2 text-muted-foreground">
                Уроки доступны. Откройте этот раздел позже.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-8 text-sm">
              <h3 className="font-semibold">
                {artifacts.length === 0
                  ? "Артефактов пока нет"
                  : "Ничего не найдено"}
              </h3>
              <p className="mt-2 text-muted-foreground">
                {artifacts.length === 0
                  ? "Здесь появятся ресурсы курса."
                  : "Попробуйте другое название."}
              </p>
              {artifacts.length === 0 ? null : (
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                  }}
                >
                  Сбросить поиск
                </Button>
              )}
            </div>
          ) : (
            <ul aria-label="Артефакты курса" className="divide-y divide-border">
              {visible.map((artifact) => (
                <li key={artifact.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      open(artifact, event.currentTarget);
                    }}
                    className="group flex min-h-16 w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {artifact.locked === true ? (
                      <Lock
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : artifact.category === "Скилл" ? (
                      <Folder
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : artifact.category === "Инструмент" ? (
                      <ExternalLink
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <FileText
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">
                        {artifact.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {artifact.category}
                        {artifact.locked === true
                          ? " · Откроется с доступом"
                          : ` · ${String(artifact.resources.length)} ${artifact.resources.length === 1 ? "ресурс" : "ресурса"}`}
                      </span>
                    </span>
                    <span className="sr-only"> — открыть артефакт</span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {opened === null ? null : (
        <ArtifactPreview
          key={opened.id}
          artifact={opened}
          onClose={() => {
            setOpened(null);
            opener.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

function Locked() {
  return (
    <p className="mt-4 inline-flex items-center gap-2 text-sm">
      <Lock aria-hidden="true" className="size-4" />
      Откроется с доступом к курсу
    </p>
  );
}

function ArtifactContents({
  artifact,
}: {
  readonly artifact: ArtifactProofItem;
}) {
  const [resourceId, setResourceId] = useState(artifact.resources[0]?.id);
  const resource =
    artifact.resources.find((item) => item.id === resourceId) ??
    artifact.resources[0];
  if (resource === undefined) return null;
  return (
    <div className="min-w-0">
      <nav
        aria-label={`${artifact.title}: состав`}
        className="mb-5 flex flex-wrap gap-2"
      >
        {artifact.resources.map((item) => (
          <Button
            key={item.id}
            variant={item.id === resource.id ? "secondary" : "outline"}
            aria-pressed={item.id === resource.id}
            className="min-h-11 max-w-full whitespace-normal break-words text-left"
            onClick={() => {
              setResourceId(item.id);
            }}
          >
            {item.kind === "link" ? (
              <ExternalLink aria-hidden="true" />
            ) : (
              <FileText aria-hidden="true" />
            )}
            {item.name}
          </Button>
        ))}
      </nav>
      <ResourceContents key={resource.id} resource={resource} />
      {artifact.bundleHref === undefined ? null : (
        <a
          href={artifact.bundleHref}
          download="demo-skill.zip"
          className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline underline-offset-4"
        >
          <Folder aria-hidden="true" className="size-4" />
          Скачать все файлы ZIP
        </a>
      )}
    </div>
  );
}

function ResourceContents({
  resource,
}: {
  readonly resource: ArtifactProofResource;
}) {
  return (
    <>
      <h3 className="mb-3 text-base font-semibold">{resource.name}</h3>
      {resource.text === undefined ? (
        resource.kind === "link" ? (
          <a
            href={resource.href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 max-w-full items-center gap-2 break-all text-sm underline underline-offset-4"
          >
            <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
            Открыть репозиторий
          </a>
        ) : (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              Для этого формата нет предпросмотра. Файл можно скачать и открыть
              на устройстве.
            </p>
            <a
              href={resource.href}
              download={resource.filename}
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4"
            >
              <Download aria-hidden="true" className="size-4" />
              Скачать {resource.filename}
            </a>
          </>
        )
      ) : (
        <TextResource
          text={resource.text}
          filename={resource.filename ?? "prompt.txt"}
        />
      )}
      {resource.prompt === undefined ? null : (
        <section className="mt-7 border-t border-border pt-5">
          <h4 className="mb-3 font-semibold">Промпт применения</h4>
          <TextResource text={resource.prompt} filename="setup-prompt.txt" />
        </section>
      )}
    </>
  );
}

function TextResource({
  text,
  filename,
}: {
  readonly text: string;
  readonly filename: string;
}) {
  const [message, setMessage] = useState("");
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11"
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(() => {
                setMessage("Текст скопирован");
              })
              .catch(() => {
                setMessage(
                  "Не удалось скопировать. Выделите текст или скачайте файл.",
                );
              });
          }}
        >
          <Copy aria-hidden="true" />
          Копировать
        </Button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download={filename}
          className="inline-flex min-h-11 items-center gap-2 px-3 text-sm underline underline-offset-4"
        >
          <Download aria-hidden="true" className="size-4" />
          Скачать {filename}
        </a>
        <span role="status" className="text-sm">
          {message}
        </span>
      </div>
      <pre
        tabIndex={0}
        aria-label={`Содержимое ${filename}`}
        className="max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-4 font-mono text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
      >
        {text}
      </pre>
    </>
  );
}

function ArtifactPreview({
  artifact,
  onClose,
}: {
  readonly artifact: ArtifactProofItem;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousBodyOverflow = document.body.style.overflow;
    const scroller = document.querySelector<HTMLElement>(
      "[data-application-content]",
    );
    const previousScrollerOverflow = scroller?.style.overflow ?? "";
    document.body.style.overflow = "hidden";
    if (scroller !== null) scroller.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = previousBodyOverflow;
      if (scroller !== null) scroller.style.overflow = previousScrollerOverflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      closedby="any"
      onClose={onClose}
      className="fixed inset-0 m-auto h-dvh max-h-dvh w-full max-w-none overflow-hidden bg-background p-0 text-foreground backdrop:bg-foreground/40 sm:h-auto sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-2xl"
      onClick={(event) => {
        if (
          "closedBy" in HTMLDialogElement.prototype ||
          event.target !== event.currentTarget
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          event.currentTarget.close();
      }}
    >
      <div className="flex max-h-dvh flex-col sm:max-h-[90dvh]">
        <header className="flex shrink-0 items-start gap-4 border-b border-border p-5 sm:p-7">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="break-words text-xl font-semibold leading-7 [overflow-wrap:anywhere] sm:text-2xl"
            >
              {artifact.title}
            </h2>
          </div>
          <Button
            aria-label="Закрыть артефакт"
            variant="ghost"
            className="min-h-11 min-w-11"
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5 pb-8 sm:p-7">
          <p className="mb-2 text-sm leading-6 text-muted-foreground">
            {artifact.purpose}
          </p>
          <p className="mb-6 text-xs text-muted-foreground">
            Обновлён {artifact.updated}
          </p>
          {artifact.locked === true ? (
            <Locked />
          ) : (
            <ArtifactContents artifact={artifact} />
          )}
        </div>
      </div>
    </dialog>
  );
}
