import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpenCheck,
  BookOpenText,
  Download,
  ExternalLink,
  FileText,
  ThumbsUp,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { MaterialCard, materialFixtures } from "@/workshop/material-preview.prototype";

export type ReadingState = "read" | "unread";

interface SkillContractRow {
  readonly authority: string;
  readonly done: string;
  readonly evidence: string;
  readonly trigger: string;
}

interface MaterialResourceFixture {
  readonly detail: string;
  readonly href: string;
  readonly kind: "file" | "link";
  readonly label: string;
}

interface LongFormMaterialFixture {
  readonly callout: string;
  readonly closingParagraph: string;
  readonly code: string;
  readonly contractRows: readonly SkillContractRow[];
  readonly diagram: {
    readonly alt: string;
    readonly caption: string;
    readonly steps: readonly string[];
  };
  readonly lead: string;
  readonly resources: readonly MaterialResourceFixture[];
  readonly seamParagraphs: readonly string[];
}

export const longFormMaterialFixture = {
  callout:
    "Skill дополняет project rules, но не отменяет их. Repository-owned AGENTS.md, product contract и tests остаются authority для конкретной работы.",
  closingParagraph:
    "Следующий шаг — проверить instruction на двух разных задачах. Если обе требуют длинных исключений, граница выбрана плохо: сузьте trigger или разделите workflow по разным outcomes.",
  code: `type SkillCheck = Readonly<{
  trigger: string
  ownerGate: string | null
  evidence: readonly string[]
}>

export const isReady = (check: SkillCheck) =>
  check.trigger.length > 0 && check.evidence.length > 0`,
  contractRows: [
    {
      authority: "Ссылается на owning source",
      done: "Называет проверку результата",
      evidence: "Изменение проверяется по canonical file",
      trigger: "Называет наблюдаемую ситуацию",
    },
    {
      authority: "Не копирует устаревающий документ",
      done: "Не заканчивается после генерации текста",
      evidence: "Test, diff или rendered evidence зелёные",
      trigger: "Не требует использовать workflow всегда",
    },
  ],
  diagram: {
    alt: "Маршрут запроса от project rules через skill к проверяемому результату",
    caption: "Один authority, один workflow, одна проверка",
    steps: ["Project rules", "Skill", "Evidence"],
  },
  lead:
    "Хороший skill начинается не с большого prompt, а с повторяемого решения. Он объясняет, когда workflow нужен, какие факты считать authority, где проходит owner gate и чем доказать результат.",
  resources: [
    {
      detail: "Markdown · 48 KB",
      href: "#skill-review-checklist",
      kind: "file",
      label: "Чек-лист проверки repository-owned skill перед публикацией",
    },
    {
      detail: "Внешний ресурс",
      href: "https://github.com/mattpocock/skills",
      kind: "link",
      label: "Пример repository-owned workflow",
    },
  ],
  seamParagraphs: [
    "Берите процесс, который уже несколько раз прошёл руками: review, release preparation или диагностику сложной ошибки. Запишите вход, observable result и границу ответственности.",
    "Общие советы без конкретного consumer не становятся отдельным skill. Чем точнее trigger и stopping condition, тем меньше скрытых решений приходится принимать исполнителю.",
  ],
} as const satisfies LongFormMaterialFixture;

interface MaterialReaderProps {
  readonly fixture: LongFormMaterialFixture;
  readonly isLiked: boolean;
  readonly isSaved: boolean;
  readonly onLikedChange: (isLiked: boolean) => void;
  readonly onReadingStateChange: (state: ReadingState) => void;
  readonly onSavedChange: (isSaved: boolean) => void;
  readonly readingState: ReadingState;
}

export function MaterialReader({
  fixture,
  isLiked,
  isSaved,
  onLikedChange,
  onReadingStateChange,
  onSavedChange,
  readingState,
}: MaterialReaderProps) {
  const material = materialFixtures.publicAgentGuide;

  return (
    <div className="@container/material-reader" data-prototype="material-reader-responsive">
      <ReaderActionBar
        isLiked={isLiked}
        isSaved={isSaved}
        onLikedChange={onLikedChange}
        onReadingStateChange={onReadingStateChange}
        onSavedChange={onSavedChange}
        placement="top"
        readingState={readingState}
      />

      <div className="mt-10 min-w-0">
        <header className="min-w-0 max-w-[56rem]">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground">
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 font-semibold text-secondary-foreground">
              <BookOpenText aria-hidden="true" className="size-3.5 text-accent" />
              {material.format}
            </span>
            <a
              className="inline-flex min-h-7 items-center rounded-md px-1 underline decoration-border underline-offset-4 hover:decoration-accent"
              href="#topic"
            >
              {material.topic}
            </a>
          </div>

          <h1 className="mt-5 max-w-[18ch] text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[2.75rem] @min-[62rem]/material-reader:text-[3.5rem]">
            {material.title}
          </h1>
          <p className="mt-5 max-w-[65ch] text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {material.summary}
          </p>
          <ul aria-label="Теги материала" className="mt-5 flex flex-wrap gap-2" role="list">
            {material.tags.map((tag) => (
              <li
                className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-[0.6875rem] text-muted-foreground"
                key={tag}
              >
                {tag}
              </li>
            ))}
          </ul>
        </header>

        <article className="mt-14 min-w-0 max-w-[70ch] text-pretty text-[1.0625rem] leading-[1.75] sm:text-lg">
          <p className="text-xl font-medium leading-[1.55] tracking-[-0.015em] text-foreground sm:text-2xl">
            {fixture.lead}
          </p>

          <ReaderSection id="stable-seam" title="Сначала найдите устойчивый seam">
            {fixture.seamParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}

            <aside
              aria-label="Важно"
              className="rounded-xl bg-secondary px-5 py-5 text-[0.9375rem] leading-7 text-secondary-foreground sm:px-6"
            >
              <p className="font-semibold">Важно</p>
              <p className="mt-1">{fixture.callout}</p>
            </aside>

            <figure>
              <figcaption className="mb-3 font-mono text-xs text-muted-foreground">
                Минимальная проверка готовности
              </figcaption>
              <pre
                aria-label="TypeScript пример SkillCheck"
                className="overflow-x-auto rounded-xl bg-sidebar p-5 font-mono text-[0.8125rem] leading-6 text-sidebar-foreground [scrollbar-color:var(--sidebar-border)_var(--sidebar)]"
                tabIndex={0}
              >
                <code>{fixture.code}</code>
              </pre>
            </figure>
          </ReaderSection>

          <ReaderSection id="test-instructions" title="Проверьте instruction на двух задачах">
            <p>{fixture.closingParagraph}</p>

            <div
              aria-label="Сравнение признаков skill contract"
              className="max-w-full overflow-x-auto rounded-xl border border-border [scrollbar-color:var(--muted-foreground)_var(--muted)]"
              role="region"
              tabIndex={0}
            >
              <table className="min-w-[48rem] border-collapse text-left text-sm leading-6">
                <caption className="sr-only">Признаки проверяемого skill contract</caption>
                <thead className="bg-muted font-mono text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium" scope="col">Trigger</th>
                    <th className="px-4 py-3 font-medium" scope="col">Authority</th>
                    <th className="px-4 py-3 font-medium" scope="col">Done</th>
                    <th className="px-4 py-3 font-medium" scope="col">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fixture.contractRows.map((row) => (
                    <tr key={row.trigger}>
                      <td className="px-4 py-3 align-top">{row.trigger}</td>
                      <td className="px-4 py-3 align-top">{row.authority}</td>
                      <td className="px-4 py-3 align-top">{row.done}</td>
                      <td className="px-4 py-3 align-top">{row.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <figure>
              <div
                aria-label={fixture.diagram.alt}
                className="grid gap-3 rounded-xl bg-sidebar p-5 text-sidebar-foreground sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center sm:p-7"
                role="img"
              >
                {fixture.diagram.steps.map((step, index) => (
                  <div className="contents" key={step}>
                    <span className="grid min-h-20 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent px-3 text-center font-mono text-xs font-semibold text-sidebar-accent-foreground">
                      {step}
                    </span>
                    {index < fixture.diagram.steps.length - 1 ? (
                      <ArrowRight
                        aria-hidden="true"
                        className="mx-auto size-4 rotate-90 text-sidebar-primary sm:rotate-0"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              <figcaption className="mt-3 text-sm text-muted-foreground">
                {fixture.diagram.caption}
              </figcaption>
            </figure>
          </ReaderSection>

          <ReaderResources resources={fixture.resources} />
        </article>
      </div>

      <ReaderActionBar
        className="mt-16"
        isLiked={isLiked}
        isSaved={isSaved}
        onLikedChange={onLikedChange}
        onReadingStateChange={onReadingStateChange}
        onSavedChange={onSavedChange}
        placement="bottom"
        readingState={readingState}
      />

      <RelatedMaterials />
    </div>
  );
}

function ReaderActionBar({
  className = "",
  isLiked,
  isSaved,
  onLikedChange,
  onReadingStateChange,
  onSavedChange,
  placement,
  readingState,
}: Pick<
  MaterialReaderProps,
  | "isLiked"
  | "isSaved"
  | "onLikedChange"
  | "onReadingStateChange"
  | "onSavedChange"
  | "readingState"
> & {
  readonly className?: string;
  readonly placement: "bottom" | "top";
}) {
  const isRead = readingState === "read";
  const likeCount = 58 + (isLiked ? 1 : 0);

  return (
    <div className={`@container/reader-actions ${className}`}>
      <div
        aria-label={`Действия с материалом ${placement === "top" ? "в начале" : "в конце"}`}
        className="flex min-w-0 items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 @min-[46rem]/reader-actions:gap-2 @min-[46rem]/reader-actions:p-2.5"
        role="group"
      >
        <Button
          asChild
          className="size-9 px-0 @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:w-auto @min-[46rem]/reader-actions:px-3"
          size="icon-lg"
          variant="outline"
        >
          <a aria-label="Назад" href="/library">
            <ArrowLeft aria-hidden="true" />
            <span className="hidden @min-[46rem]/reader-actions:inline">Назад</span>
          </a>
        </Button>

        <Button
          aria-label={isSaved ? "Сохранено" : "Сохранить"}
          aria-pressed={isSaved}
          className="size-9 px-0 @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:w-auto @min-[46rem]/reader-actions:px-3"
          onClick={() => {
            onSavedChange(!isSaved);
          }}
          size="icon-lg"
          variant="outline"
        >
          <Bookmark aria-hidden="true" className={isSaved ? "fill-current" : undefined} />
          <span className="hidden @min-[46rem]/reader-actions:inline">
            {isSaved ? "Сохранено" : "Сохранить"}
          </span>
        </Button>

        <Button
          aria-label={isRead ? "Изучено" : "Отметить изученным"}
          aria-pressed={isRead}
          className="h-9 min-w-0 flex-1 px-1.5 text-[0.8125rem] @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:flex-none @min-[46rem]/reader-actions:px-3 @min-[46rem]/reader-actions:text-sm"
          onClick={() => {
            onReadingStateChange(isRead ? "unread" : "read");
          }}
          size="lg"
          variant="outline"
        >
          <BookOpenCheck aria-hidden="true" />
          <span className="@min-[46rem]/reader-actions:hidden">
            {isRead ? "Изучено" : "Изучить"}
          </span>
          <span className="hidden @min-[46rem]/reader-actions:inline">
            {isRead ? "Изучено" : "Отметить изученным"}
          </span>
        </Button>

        <Button
          aria-label={["Нравится", likeCount].join(" ")}
          aria-pressed={isLiked}
          className="h-9 px-2 text-[0.8125rem] tabular-nums @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:px-3 @min-[46rem]/reader-actions:text-sm"
          onClick={() => {
            onLikedChange(!isLiked);
          }}
          size="lg"
          variant="outline"
        >
          <ThumbsUp aria-hidden="true" className={isLiked ? "fill-current" : undefined} />
          <span className="hidden @min-[46rem]/reader-actions:inline">Нравится</span>
          <span className="text-muted-foreground">{likeCount}</span>
        </Button>

        <Button
          asChild
          className="size-9 px-0 @min-[46rem]/reader-actions:ml-auto @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:w-auto @min-[46rem]/reader-actions:px-4"
          size="icon-lg"
        >
          <a aria-label="Следующий материал" href="/library/material-platform-delivery">
            <span className="hidden @min-[46rem]/reader-actions:inline">Следующий материал</span>
            <ArrowRight aria-hidden="true" />
          </a>
        </Button>
      </div>
    </div>
  );
}

function ReaderSection({
  children,
  id,
  title,
}: {
  readonly children: React.ReactNode;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <section className="mt-14 space-y-6 scroll-mt-8" id={id}>
      <h2 className="max-w-[22ch] text-balance text-2xl font-semibold leading-tight tracking-[-0.03em] sm:text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReaderResources({ resources }: { readonly resources: readonly MaterialResourceFixture[] }) {
  return (
    <section className="mt-14 scroll-mt-8" id="resources">
      <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Resources</h2>
      <ul className="mt-5 divide-y divide-border border-y border-border" role="list">
        {resources.map((resource) => {
          const Icon = resource.kind === "file" ? FileText : ExternalLink;

          return (
            <li key={resource.label}>
              <a
                className="group flex min-h-20 items-center gap-3 py-4 no-underline"
                href={resource.href}
                rel={resource.kind === "link" ? "noreferrer" : undefined}
                target={resource.kind === "link" ? "_blank" : undefined}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">{resource.label}</span>
                  <span className="mt-1 block font-mono text-[0.6875rem] text-muted-foreground">
                    {resource.detail}
                  </span>
                </span>
                {resource.kind === "file" ? (
                  <Download aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-accent" />
                ) : (
                  <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-accent" />
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RelatedMaterials() {
  return (
    <section aria-labelledby="related-materials" className="mt-20 border-t border-border pt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em]" id="related-materials">
            Продолжить чтение
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">Материалы по соседним workflow.</p>
        </div>
        <a
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold underline decoration-border underline-offset-4 hover:decoration-accent"
          href="/library"
        >
          Вся библиотека
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </div>
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
        <MaterialCard headingLevel="h3" material={materialFixtures.platformDeliveryVideo} />
        <MaterialCard headingLevel="h3" material={materialFixtures.careerVideo} />
      </div>
    </section>
  );
}
