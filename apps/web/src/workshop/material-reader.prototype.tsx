import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  BookOpenText,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  MaterialCard,
  materialFixtures,
  type MaterialPreviewFixture,
} from "@/workshop/material-preview.prototype";

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
  readonly outcomes: readonly string[];
  readonly nextMaterial?: MaterialPreviewFixture;
  readonly relatedMaterials: readonly MaterialPreviewFixture[];
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
  outcomes: [
    "Найти устойчивый seam",
    "Собрать trigger, authority и evidence",
    "Проверить instruction на двух задачах",
  ],
  relatedMaterials: [materialFixtures.platformDeliveryVideo, materialFixtures.careerVideo],
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
  readonly onReadingStateChange: (state: ReadingState) => void;
  readonly readingState: ReadingState;
}

export function MaterialReader({
  fixture,
  onReadingStateChange,
  readingState,
}: MaterialReaderProps) {
  const material = materialFixtures.publicAgentGuide;

  return (
    <div className="@container/material-reader" data-prototype="material-reader-responsive">
      <ReaderActionBar
        nextMaterial={fixture.nextMaterial}
        onReadingStateChange={onReadingStateChange}
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

          <h1 className="mt-5 max-w-[22ch] text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[2.5rem] @min-[62rem]/material-reader:text-[3rem]">
            {material.title}
          </h1>
          <p className="mt-4 max-w-[65ch] text-pretty text-[0.9375rem] leading-6 text-muted-foreground sm:mt-5 sm:text-lg sm:leading-8">
            {material.summary}
          </p>
          <ul aria-label="Теги материала" className="mt-5 flex flex-wrap gap-2" role="list">
            {material.tags.map((tag) => (
              <li key={tag}>
                <a
                  className="inline-flex min-h-8 items-center rounded-md bg-muted px-2.5 py-1.5 font-mono text-[0.6875rem] text-muted-foreground no-underline hover:bg-secondary hover:text-foreground focus-visible:outline-ring"
                  href={`/library?query=${encodeURIComponent(tag)}`}
                >
                  {tag}
                </a>
              </li>
            ))}
          </ul>
        </header>

        <LearningOutcomes outcomes={fixture.outcomes} />
        <ReaderOutline />

        <article className="mt-10 min-w-0 max-w-[70ch] text-pretty text-[0.96875rem] leading-[1.7] sm:mt-12 sm:text-lg">
          <p className="text-[1.0625rem] font-medium leading-[1.6] tracking-[-0.015em] text-foreground sm:text-2xl">
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
        nextMaterial={fixture.nextMaterial}
        onReadingStateChange={onReadingStateChange}
        placement="bottom"
        readingState={readingState}
      />

      <NextLearningSteps
        nextMaterial={fixture.nextMaterial}
        relatedMaterials={fixture.relatedMaterials}
      />
    </div>
  );
}

const readerOutlineItems = [
  { href: "#stable-seam", label: "Устойчивый seam" },
  { href: "#test-instructions", label: "Проверка instruction" },
  { href: "#resources", label: "Resources" },
] as const;

function ReaderOutline() {
  const links = readerOutlineItems.map((item) => (
    <li key={item.href}>
      <a
        className="flex min-h-10 items-center rounded-lg px-2 text-sm text-muted-foreground no-underline hover:bg-muted hover:text-foreground focus-visible:outline-ring"
        href={item.href}
      >
        {item.label}
      </a>
    </li>
  ));

  return (
    <div className="mt-6 max-w-[70ch]">
      <details className="group rounded-xl bg-muted/60 @min-[40rem]/material-reader:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 text-sm font-semibold focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          В этом материале
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <nav aria-label="В этом материале" className="border-t border-border px-1.5 py-1.5">
          <ul role="list">{links}</ul>
        </nav>
      </details>

      <nav
        aria-label="В этом материале"
        className="hidden rounded-xl bg-muted/60 px-2 py-3 @min-[40rem]/material-reader:block"
      >
        <p className="px-2 text-sm font-semibold">В этом материале</p>
        <ul className="mt-2 grid grid-cols-3 gap-2" role="list">
          {links}
        </ul>
      </nav>
    </div>
  );
}

function LearningOutcomes({ outcomes }: { readonly outcomes: readonly string[] }) {
  return (
    <section
      aria-labelledby="learning-outcomes"
      className="mt-8 max-w-[70ch]"
    >
      <h2 className="text-sm font-semibold" id="learning-outcomes">
        После материала вы сможете
      </h2>
      <ul
        className="mt-3 grid gap-2 text-sm leading-5 text-muted-foreground @min-[40rem]/material-reader:mt-4 @min-[40rem]/material-reader:grid-cols-3 @min-[40rem]/material-reader:gap-3 @min-[40rem]/material-reader:leading-6"
        role="list"
      >
        {outcomes.map((outcome) => (
          <li className="flex items-start gap-2" key={outcome}>
            <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-accent" />
            <span>{outcome}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReaderActionBar({
  className = "",
  nextMaterial,
  onReadingStateChange,
  placement,
  readingState,
}: Pick<MaterialReaderProps, "onReadingStateChange" | "readingState"> & {
  readonly className?: string;
  readonly nextMaterial: MaterialPreviewFixture | undefined;
  readonly placement: "bottom" | "top";
}) {
  const isRead = readingState === "read";

  return (
    <div
      className={`@container/reader-actions ${placement === "top" ? "pt-3 @min-[46rem]/reader-actions:pt-0" : ""} ${className}`}
    >
      <div
        aria-label={`Действия с материалом ${placement === "top" ? "в начале" : "в конце"}`}
        className="flex min-w-0 items-center justify-between gap-1 @min-[46rem]/reader-actions:justify-start @min-[46rem]/reader-actions:gap-2 @min-[46rem]/reader-actions:rounded-xl @min-[46rem]/reader-actions:border @min-[46rem]/reader-actions:border-border @min-[46rem]/reader-actions:bg-card @min-[46rem]/reader-actions:p-2.5"
        role="group"
      >
        <Button
          asChild
          className="size-11 border-transparent bg-transparent px-0 @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:w-auto @min-[46rem]/reader-actions:border-border @min-[46rem]/reader-actions:bg-background @min-[46rem]/reader-actions:px-3"
          size="icon-lg"
          variant="outline"
        >
          <a aria-label="Назад" href="/library">
            <ArrowLeft aria-hidden="true" />
            <span className="hidden @min-[46rem]/reader-actions:inline">Назад</span>
          </a>
        </Button>

        <Button
          aria-label={isRead ? "Прочитано" : "Не прочитано"}
          aria-pressed={isRead}
          className="h-11 border-transparent bg-transparent px-3 text-sm aria-pressed:bg-secondary aria-pressed:text-secondary-foreground @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:border-border @min-[46rem]/reader-actions:bg-background"
          onClick={() => {
            onReadingStateChange(isRead ? "unread" : "read");
          }}
          size="lg"
          variant="outline"
        >
          <BookOpenCheck aria-hidden="true" />
          <span>{isRead ? "Прочитано" : "Не прочитано"}</span>
        </Button>

        {nextMaterial ? (
          <Button
            asChild
            className="size-11 px-0 @min-[46rem]/reader-actions:ml-auto @min-[46rem]/reader-actions:h-10 @min-[46rem]/reader-actions:w-auto @min-[46rem]/reader-actions:px-4"
            size="icon-lg"
          >
            <a aria-label="Следующий материал" href={`/library/${nextMaterial.id}`}>
              <span className="hidden @min-[46rem]/reader-actions:inline">Следующий материал</span>
              <ArrowRight aria-hidden="true" />
            </a>
          </Button>
        ) : null}
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
    <section className="mt-12 space-y-5 scroll-mt-8 sm:mt-14 sm:space-y-6" id={id}>
      <h2 className="max-w-[22ch] text-balance text-xl font-semibold leading-tight tracking-[-0.03em] sm:text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReaderResources({ resources }: { readonly resources: readonly MaterialResourceFixture[] }) {
  return (
    <section className="mt-12 scroll-mt-8 sm:mt-14" id="resources">
      <h2 className="text-xl font-semibold tracking-[-0.03em] sm:text-3xl">Resources</h2>
      <ul className="mt-4 grid gap-2 sm:mt-5" role="list">
        {resources.map((resource) => {
          const Icon = resource.kind === "file" ? FileText : ExternalLink;

          return (
            <li key={resource.label}>
              <a
                className="group flex min-h-20 items-center gap-3 rounded-xl bg-muted/60 px-3 py-4 no-underline hover:bg-muted"
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

function NextLearningSteps({
  nextMaterial,
  relatedMaterials,
}: {
  readonly nextMaterial: MaterialPreviewFixture | undefined;
  readonly relatedMaterials: readonly MaterialPreviewFixture[];
}) {
  return (
    <section
      aria-labelledby="next-learning-step"
      className="@container/learning-path mt-16 sm:mt-20"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl" id="next-learning-step">
            {nextMaterial ? "Продолжить серию" : "По теме"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {nextMaterial
              ? "Следующий материал в подтверждённой последовательности."
              : "Связанные материалы для следующего учебного шага."}
          </p>
        </div>
        <a
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold underline decoration-border underline-offset-4 hover:decoration-accent"
          href="/library"
        >
          Вся библиотека
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </div>
      <div className="mt-7 grid items-start gap-8 @min-[54rem]/learning-path:grid-cols-2">
        {nextMaterial ? (
          <div className="min-w-0">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ArrowRight aria-hidden="true" className="size-4 text-accent" />
              Следующий материал
            </p>
            <MaterialCard headingLevel="h3" material={nextMaterial} />
          </div>
        ) : null}
        {relatedMaterials.map((material) => (
          <div className="min-w-0" key={material.id}>
            <MaterialCard headingLevel="h3" material={material} />
          </div>
        ))}
      </div>
    </section>
  );
}
