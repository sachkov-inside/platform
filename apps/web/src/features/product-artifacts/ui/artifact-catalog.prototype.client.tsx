"use client";

import {
  ArrowLeft,
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

import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
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

const variants = [
  "Список и окно",
  "Открытые разделы",
  "Список и просмотр",
] as const;
const categories = ["Все", "Промпт", "Скилл", "Инструмент", "Файл"] as const;

/** Three catalog compositions in the existing public shell, with one resource model. */
export function ArtifactCatalogProof({
  artifacts,
  initialVariant = 0,
  context = "catalog",
  status = "ready",
}: {
  readonly artifacts: readonly ArtifactProofItem[];
  readonly initialVariant?: number;
  readonly context?: "catalog" | "lesson";
  readonly status?: "ready" | "loading" | "error";
}) {
  const [variant, setVariant] = useState(() => {
    const fromUrl = new URL(window.location.href).searchParams.get("variant");
    return fromUrl !== null && [0, 1, 2].includes(Number(fromUrl))
      ? Number(fromUrl)
      : initialVariant;
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("Все");
  const [variantsExpanded, setVariantsExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState(artifacts[0]?.id);
  const [opened, setOpened] = useState<ArtifactProofItem | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const visible = artifacts.filter(
    (artifact) =>
      (category === "Все" || artifact.category === category) &&
      `${artifact.title} ${artifact.purpose} ${artifact.resources.map((resource) => resource.name).join(" ")}`
        .toLocaleLowerCase("ru")
        .includes(search.toLocaleLowerCase("ru")),
  );
  const selected =
    visible.find((artifact) => artifact.id === selectedId) ?? visible[0];

  function changeVariant(next: number) {
    setVariant((next + variants.length) % variants.length);
    const url = new URL(window.location.href);
    url.searchParams.set(
      "variant",
      String((next + variants.length) % variants.length),
    );
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable], dialog") !==
          null
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setVariant((current) => {
        const next =
          (current + (event.key === "ArrowRight" ? 1 : -1) + variants.length) %
          variants.length;
        const url = new URL(window.location.href);
        url.searchParams.set("variant", String(next));
        window.history.replaceState(null, "", url);
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function open(artifact: ArtifactProofItem, button: HTMLButtonElement) {
    opener.current = button;
    setOpened(artifact);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-32 pt-8 sm:px-10 sm:pt-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <IntentPrefetchLink
          href="/library/series/inside-ai-engineering"
          className="inline-flex min-h-11 items-center gap-2 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />К программе курса
        </IntentPrefetchLink>
        <Button
          variant="ghost"
          className="min-h-11"
          aria-expanded={variantsExpanded}
          onClick={() => {
            setVariantsExpanded(true);
          }}
        >
          Варианты прототипа
        </Button>
      </div>
      {context === "lesson" ? (
        <article className="mx-auto max-w-3xl py-8">
          <h1 className="text-3xl font-semibold tracking-tight">
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
              className="mt-6 flex w-full items-center gap-4 rounded-xl border border-border p-5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <FileText aria-hidden="true" className="size-6 shrink-0" />
              <span>
                <span className="block font-semibold">
                  {artifacts[0].title}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Открыть артефакт из курса
                </span>
              </span>
            </button>
          )}
          <h2 className="mt-12 text-xl font-semibold">Проверьте результат</h2>
          <p className="mt-4 leading-8">
            Вы должны понимать, где проект принимает запросы, хранит данные и
            проверяет изменения. После просмотра артефакта продолжите чтение с
            этого места.
          </p>
        </article>
      ) : (
        <>
          <header className="mb-8 mt-5 max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Артефакты курса
            </h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Промпты, скиллы и инструменты для Inside AI Engineering. Откройте
              ресурс, посмотрите состав и возьмите то, что нужно сейчас.
            </p>
          </header>
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block sm:w-80">
              <span className="sr-only">Найти артефакт</span>
              <Search
                aria-hidden="true"
                className="absolute left-3 top-3.5 size-4 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                placeholder="Название или задача"
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex flex-wrap gap-1" aria-label="Вид артефакта">
              {categories.map((item) => (
                <Button
                  key={item}
                  variant={category === item ? "secondary" : "ghost"}
                  className="min-h-11"
                  aria-pressed={category === item}
                  onClick={() => {
                    setCategory(item);
                  }}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>
          {status === "loading" ? (
            <p role="status" className="py-12">
              Загружаем артефакты…
            </p>
          ) : status === "error" ? (
            <div role="alert" className="py-12">
              <h2 className="font-semibold">Не удалось загрузить артефакты</h2>
              <p className="mt-2 text-muted-foreground">
                Уроки доступны. Вернитесь к каталогу позже.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12">
              <h2 className="text-xl font-semibold">
                {artifacts.length === 0
                  ? "Артефактов пока нет"
                  : "Ничего не найдено"}
              </h2>
              <p className="mt-2 text-muted-foreground">
                {artifacts.length === 0
                  ? "Здесь появятся ресурсы курса."
                  : "Попробуйте другое название или выберите все виды."}
              </p>
              {artifacts.length === 0 ? null : (
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => {
                    setCategory("Все");
                    setSearch("");
                  }}
                >
                  Сбросить поиск
                </Button>
              )}
            </div>
          ) : variant === 1 ? (
            <div className="space-y-10">
              {visible.map((artifact) => (
                <section
                  key={artifact.id}
                  className="border-t border-border pt-6"
                >
                  <ArtifactHeading artifact={artifact} />
                  {artifact.locked === true ? (
                    <Locked />
                  ) : (
                    <div className="mt-5">
                      <ArtifactContents key={artifact.id} artifact={artifact} />
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div
              className={
                variant === 2
                  ? "grid items-start gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
                  : ""
              }
            >
              <ul
                aria-label="Артефакты курса"
                className="divide-y divide-border border-y border-border"
              >
                {visible.map((artifact) => (
                  <li
                    key={artifact.id}
                    className={
                      variant === 2 && selected?.id === artifact.id
                        ? "bg-secondary/60"
                        : ""
                    }
                  >
                    <div className="flex items-start gap-4 py-6">
                      <div className="min-w-0 flex-1">
                        <ArtifactHeading
                          artifact={artifact}
                          compact={variant === 2}
                        />
                        {artifact.locked === true ? (
                          <Locked />
                        ) : (
                          <Button
                            variant="outline"
                            className="mt-4 min-h-11"
                            onClick={(event) => {
                              setSelectedId(artifact.id);
                              if (
                                variant !== 2 ||
                                window.matchMedia("(max-width: 767px)").matches
                              )
                                open(artifact, event.currentTarget);
                            }}
                          >
                            {variant === 2 ? "Посмотреть" : "Открыть артефакт"}
                            <ArrowRight aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {variant === 2 && selected !== undefined ? (
                <section
                  className="hidden min-w-0 rounded-xl bg-card p-6 md:block"
                  aria-label="Просмотр выбранного артефакта"
                >
                  <ArtifactHeading artifact={selected} />
                  {selected.locked === true ? (
                    <Locked />
                  ) : (
                    <div className="mt-6">
                      <ArtifactContents key={selected.id} artifact={selected} />
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </>
      )}
      {variantsExpanded ? (
        <aside
          aria-label="Варианты прототипа"
          className="fixed bottom-20 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-primary p-2 text-primary-foreground shadow-[var(--elevation-floating-nav)] lg:bottom-5"
        >
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 text-primary-foreground hover:bg-sidebar-accent hover:text-primary-foreground"
            aria-label="Предыдущий вариант"
            onClick={() => {
              changeVariant(variant - 1);
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <span className="text-center text-xs font-medium">
            Прототип · {variants[variant]}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 text-primary-foreground hover:bg-sidebar-accent hover:text-primary-foreground"
            aria-label="Следующий вариант"
            onClick={() => {
              changeVariant(variant + 1);
            }}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 text-primary-foreground hover:bg-sidebar-accent hover:text-primary-foreground"
            aria-label="Свернуть варианты"
            onClick={() => {
              setVariantsExpanded(false);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </aside>
      ) : null}
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

function ArtifactHeading({
  artifact,
  compact = false,
}: {
  readonly artifact: ArtifactProofItem;
  readonly compact?: boolean;
}) {
  return (
    <>
      <h2
        className={
          compact
            ? "text-base font-semibold leading-6"
            : "text-xl font-semibold leading-7"
        }
      >
        {artifact.title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {artifact.purpose}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        {artifact.category}
        {artifact.locked === true
          ? ""
          : ` · ${String(artifact.resources.length)} ${artifact.resources.length === 1 ? "ресурс" : "ресурса"}`}{" "}
        · Обновлён {artifact.updated}
      </p>
    </>
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
      className="fixed inset-0 m-auto h-dvh max-h-dvh w-full max-w-none overflow-hidden bg-background p-0 text-foreground backdrop:bg-foreground/40 sm:h-auto sm:max-h-[90dvh] sm:max-w-4xl sm:rounded-2xl"
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
