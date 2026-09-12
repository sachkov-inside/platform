import { isDeepStrictEqual } from "node:util";

import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import {
  assembleMaterials,
  type MaterialBodySnapshot,
  type MaterialMetadataSelectionInput,
} from "../modules/materials/index.js";
import {
  assembleVideos,
  type VideoProvider,
} from "../modules/videos/index.js";
import { seedLocalOfferCatalog } from "./seed-local-offer-catalog.js";

const actor = "72000000-0000-4000-8000-000000000001";
const topicId = "72000000-0000-4000-8000-000000000002";

const formatId = "guide";
const createIdempotencyKey = "72000000-0000-4000-8000-000000000004";
const tagId = "72000000-0000-4000-8000-000000000006";
const progressSeriesId = "72000000-0000-4000-8000-000000000332";
const seriesId = "72000000-0000-4000-8000-000000000007";
const demoHarnessSeriesId = "72000000-0000-4000-8000-000000000295";
const demoStepsSeriesId = "72000000-0000-4000-8000-000000000298";
const demoStepsSharedSeriesId = "72000000-0000-4000-8000-000000000299";
const demoReviewSeriesId = "72000000-0000-4000-8000-000000000296";
const slug = "kak-ustroen-inside-platform";
const membershipSlug = "developer-pipeline-bez-poteri-konteksta";
const membershipCreateIdempotencyKey = "72000000-0000-4000-8000-000000000033";
const videoFormatId = "video";
const noteFormatId = "note";
const localVideoProjects = {
  free: "local-development-free",
  membership: "local-development-membership",
} as const;
const localVideoFixtures: ReadonlyMap<string, {
  readonly durationSeconds: number;
  readonly title: string;
}> = new Map([
  ["local-home-developer-pipeline", {
    durationSeconds: 628,
    title: "Видео про Developer Pipeline",
  }],
  ["local-home-deep-modules", {
    durationSeconds: 481,
    title: "Глубокие модули на практике",
  }],
  ["local-home-product-context", {
    durationSeconds: 754,
    title: "Продукт и инженерный контекст",
  }],
  ["local-series-release-overview", { durationSeconds: 630, title: "Demo · Как устроен релиз" }],
  ["local-series-release-docker", { durationSeconds: 810, title: "Demo · Docker на примере" }],
  ["local-series-review-video", {
    durationSeconds: 542,
    title: "Demo #295 · Видео-разбор",
  }],
]);

export interface LocalDevelopmentSeed {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly slug: string;
}

export async function seedLocalDevelopment(
  prisma: PlatformPrisma,
): Promise<LocalDevelopmentSeed> {
  await ensureReferenceData(prisma);

  const videos = assembleVideos({
    canManage: (accountId) => Promise.resolve(accountId === actor),
    prisma,
    projects: localVideoProjects,
    provider: localDevelopmentVideoProvider,
  });
  const { authoring } = assembleMaterials({
    prisma,
    authorPolicy: {
      canManage: (accountId) => accountId === actor,
    },
    videos,
  });
  const seed: SeedContext = { authoring, prisma, videos };
  await ensureCatalogContinuationMaterials(seed);
  await ensureHomeMaterials(seed);
  await ensureSeriesReaderScenario(seed);
  const representativeMaterial = {
    metadata: {
      title: "Как устроен Inside Platform",
      summary: "Representative published Material для локальной full-stack разработки.",
      access: "free",
      difficulty: null,
      outcomes: [],
      topicId,
      formatId,
      tagIds: [tagId],
      seriesIds: [seriesId],
    },
    body: {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: {
              level: 2,
              nodeId: "72000000-0000-4000-8000-000000000010",
            },
            content: [{ type: "text", text: "Первый вертикальный срез" }],
          },
          {
            type: "paragraph",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000011" },
            content: [
              {
                type: "text",
                text: "Этот материал создаётся идемпотентным local seed через application interface.",
              },
            ],
          },
          {
            type: "bulletList",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000012" },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { nodeId: "72000000-0000-4000-8000-000000000013" },
                    content: [{ type: "text", text: "PostgreSQL хранит current Material." }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { nodeId: "72000000-0000-4000-8000-000000000014" },
                    content: [{ type: "text", text: "Nest применяет access policy." }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { nodeId: "72000000-0000-4000-8000-000000000015" },
                    content: [{ type: "text", text: "Next server-renders Reader." }],
                  },
                ],
              },
            ],
          },
          {
            type: "callout",
            attrs: {
              kind: "note",
              nodeId: "72000000-0000-4000-8000-000000000016",
            },
            content: [
              {
                type: "paragraph",
                attrs: { nodeId: "72000000-0000-4000-8000-000000000017" },
                content: [
                  {
                    type: "text",
                    text: "Один production path остаётся authority для browser и tests.",
                  },
                ],
              },
            ],
          },
          {
            type: "heading",
            attrs: {
              level: 2,
              nodeId: "72000000-0000-4000-8000-000000000018",
            },
            content: [{ type: "text", text: "Проверяемый результат" }],
          },
          {
            type: "codeBlock",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000019" },
            content: [{ type: "text", text: "pnpm smoke:fullstack" }],
          },
          {
            type: "table",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000020" },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000021" },
                        content: [{ type: "text", text: "Seam" }],
                      },
                    ],
                  },
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000022" },
                        content: [{ type: "text", text: "Evidence" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000023" },
                        content: [{ type: "text", text: "Reader route" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000024" },
                        content: [{ type: "text", text: "Meaningful initial HTML" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "assetImage",
            attrs: {
              nodeId: "72000000-0000-4000-8000-000000000025",
              assetId: "72000000-0000-4000-8000-000000000030",
              alt: "Путь Material от PostgreSQL до Reader",
              caption: "Один vertical production path",
            },
          },
          {
            type: "assetFile",
            attrs: {
              nodeId: "72000000-0000-4000-8000-000000000026",
              assetId: "72000000-0000-4000-8000-000000000031",
              label: "Reader verification checklist",
            },
          },
        ],
      },
    },
  } as const;
  const overview = await ensureSeededMaterial(seed, {
    ...representativeMaterial,
    createIdempotencyKey,
    saveIdempotencyKeyPrefix: "local-overview-save",
    slug,
  });

  await ensureMembershipCatalogMaterial(seed);
  await ensureRelatedPin(prisma, overview.materialId);
  // Каталог заводится последним: разовое предложение продаёт уже засеянное руководство.
  await seedLocalOfferCatalog(prisma, { actor, guideId: seriesId });

  return Object.freeze({
    materialId: overview.materialId,
    contentVersion: overview.contentVersion,
    slug,
  });
}

/**
 * A step written for both ways of going through a guide, so the local platform shows the mode
 * switch, the one-time hint and the link to the branch the reader is not in.
 */
function modeVariantBlock(step: string, title: string) {
  return {
    attrs: { nodeId: `77000000-0000-4000-8000-${step}` },
    content: [
      {
        attrs: { mode: "example" },
        content: [
          {
            attrs: { nodeId: `78000000-0000-4000-8000-${step}` },
            content: [
              {
                type: "text",
                text: `Учебный проект: повторите «${title}» на демонстрационном репозитории, ничего не меняя в своём.`,
              },
            ],
            type: "paragraph",
          },
        ],
        type: "variantOption",
      },
      {
        attrs: { mode: "own" },
        content: [
          {
            attrs: { nodeId: `79000000-0000-4000-8000-${step}` },
            content: [
              {
                type: "text",
                text: `Свой проект: примените «${title}» к своему репозиторию и запишите, что пришлось изменить.`,
              },
            ],
            type: "paragraph",
          },
        ],
        type: "variantOption",
      },
    ],
    type: "variant",
  } as const;
}

async function ensureSeriesReaderScenario(seed: SeedContext): Promise<void> {
  const { authoring } = seed;
  const definitions = [
    {
      bodyText: "Development-образец общей точки для проверки разных контекстов Серий.",
      formatId,
      seriesIds: [demoHarnessSeriesId, demoReviewSeriesId],
      orderKey: "demo-295-obshchiy-gayd",
      title: "Demo #295 · Общий гайд",
    },
    {
      bodyText: "Development-образец завершения основной Серии.",
      formatId,
      seriesIds: [demoHarnessSeriesId],
      orderKey: "demo-295-finalnyy-gayd",
      title: "Demo #295 · Финальный гайд",
    },
    {
      bodyText: "Development-образец видео внутри смешанной Серии.",
      formatId: videoFormatId,
      providerVideoId: "local-series-review-video",
      seriesIds: [demoReviewSeriesId],
      orderKey: "demo-295-video-razbor",
      title: "Demo #295 · Видео-разбор",
    },
    {
      bodyText: "Development-образец заметки внутри смешанной Серии.",
      formatId: noteFormatId,
      seriesIds: [demoReviewSeriesId],
      orderKey: "demo-295-itogovaya-zametka",
      title: "Demo #295 · Итоговая заметка",
    },
    {
      bodyText: "Development standalone #295: материал открывается без случайного контекста Серии.",
      formatId: noteFormatId,
      seriesIds: [],
      orderKey: "demo-295-samostoyatelnaya-zametka",
      title: "Demo #295 · Самостоятельная заметка",
    },
    ...[
      { orderKey: "demo-298-release-overview", title: "Как устроен релиз моего проекта", formatId: videoFormatId, providerVideoId: "local-series-release-overview", summary: "Разбираем путь от коммита до работающего сервиса: сборку, публикацию и откат релиза.", difficulty: "basic" as const, outcomes: ["Видеть весь путь релиза целиком", "Называть шаги, на которых релиз ломается чаще всего"] },
      // Два шага написаны для обоих режимов прохождения: на них виден переключатель.
      { orderKey: "demo-298-prepare", title: "Подготовка приложения к релизу", formatId, difficulty: "basic" as const, outcomes: ["Собрать приложение под релиз", "Проверить сборку до публикации"], modes: true },
      { orderKey: "demo-298-docker", title: "Разбираем Docker на реальном примере", formatId: videoFormatId, providerVideoId: "local-series-release-docker", summary: "Разбираем сеть, переменные окружения и тома Docker Compose на примере запуска приложения.", difficulty: "intermediate" as const, outcomes: ["Запустить приложение в Compose", "Прочитать логи упавшего контейнера", "Разложить переменные окружения по слоям"] },
      { orderKey: "demo-298-secrets", title: "Что проверить перед передачей секретов", formatId: noteFormatId, difficulty: "intermediate" as const },
      { orderKey: "demo-298-environment", title: "Настройка окружения", formatId, difficulty: "intermediate" as const, modes: true },
      { orderKey: "demo-298-deploy", title: "Первый деплой и проверка результата", formatId, difficulty: "advanced" as const, outcomes: ["Выкатить первую версию", "Убедиться, что она отвечает", "Откатиться, когда она не отвечает"] },
    ].map((definition) => ({
      ...definition,
      title: `Demo · ${definition.title}`,
      bodyText: "Тестовый материал серии о релизе. Демонстрирует общий порядок видео, заметок и связанных шагов инструкции.",
      seriesIds: definition.orderKey === "demo-298-prepare" ? [demoStepsSeriesId, demoStepsSharedSeriesId] : [demoStepsSeriesId],
    })),
  ] as const;

  const materialIds = new Map<string, string>();
  for (const [index, definition] of definitions.entries()) {
    const metadata = {
      access: "free" as const,
      difficulty: "difficulty" in definition ? definition.difficulty : null,
      formatId: definition.formatId,
      outcomes: "outcomes" in definition ? definition.outcomes : [],
      seriesIds: definition.seriesIds,
      summary: "summary" in definition && definition.summary !== undefined
        ? definition.summary
        : `${definition.bodyText} Не является контентом Кирилла.`,
      tagIds: [tagId],
      title: definition.title,
      topicId,
    };
    const step = String(index + 1).padStart(12, "0");
    const body = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            attrs: { nodeId: `76000000-0000-4000-8000-${step}` },
            content: [{ type: "text", text: definition.bodyText }],
            type: "paragraph",
          },
          ...("modes" in definition
            ? [modeVariantBlock(step, definition.title)]
            : []),
        ],
      },
    } as const;
    // Определения серии о релизе не несут хранимого slug: его выдаёт модуль Материалов из
    // заголовка при публикации, а `orderKey` здесь — локальный ключ порядка внутри серии.
    // Поэтому материал опознаётся заголовком; переименование заголовка здесь заведёт новый
    // материал вместо обновления прежнего.
    const seeded = await ensureSeededMaterial(seed, {
      body,
      createIdempotencyKey: `local-series-demo-create-${String(index + 1)}`,
      metadata,
      saveIdempotencyKeyPrefix: `local-series-demo-save-${String(index + 1)}`,
      ...("providerVideoId" in definition
        ? { providerVideoId: definition.providerVideoId }
        : {}),
    });
    materialIds.set(definition.orderKey, seeded.materialId);
  }

  const releaseKeys = ["demo-298-release-overview", "demo-298-prepare", "demo-298-docker", "demo-298-secrets", "demo-298-environment", "demo-298-deploy"];
  await ensureDevelopmentSeriesOrder(authoring, demoStepsSeriesId,
    releaseKeys.map((value) => requiredMaterialId(materialIds, value)),
    Object.fromEntries(["demo-298-prepare", "demo-298-environment", "demo-298-deploy"].map((value) => [requiredMaterialId(materialIds, value), "От проекта до релиза"])),
  );
  await ensureDevelopmentSeriesOrder(authoring, demoStepsSharedSeriesId, [requiredMaterialId(materialIds, "demo-298-prepare")], {});
  await ensureDevelopmentSeriesOrder(authoring, demoHarnessSeriesId, [
    requiredMaterialId(materialIds, "demo-295-obshchiy-gayd"),
    requiredMaterialId(materialIds, "demo-295-finalnyy-gayd"),
  ]);
  await ensureDevelopmentSeriesOrder(authoring, demoReviewSeriesId, [
    requiredMaterialId(materialIds, "demo-295-obshchiy-gayd"),
    requiredMaterialId(materialIds, "demo-295-video-razbor"),
    requiredMaterialId(materialIds, "demo-295-itogovaya-zametka"),
  ]);
}

/** Всё, чем засев пишет материалы: одна связка вместо трёх параметров у каждой функции. */
interface SeedContext {
  readonly authoring: ReturnType<typeof assembleMaterials>["authoring"];
  readonly prisma: PlatformPrisma;
  readonly videos: ReturnType<typeof assembleVideos>;
}

interface SeededMaterialDefinition {
  readonly body: MaterialBodySnapshot;
  readonly createIdempotencyKey: string;
  /** Заголовок обязателен: он опознаёт засеянный материал и из него выдаётся хранимый slug. */
  readonly metadata: MaterialMetadataSelectionInput & { readonly title: string };
  readonly providerVideoId?: string;
  readonly saveIdempotencyKeyPrefix: string;
  /** Хранимый slug, когда определение им владеет; иначе материал опознаётся заголовком. */
  readonly slug?: string;
}

/**
 * Один материал стенда: он существует, он опубликован и он равен своему определению.
 *
 * Каждый засеянный материал проходит здесь, и сравнение перед Save одно на всех. Обе половины
 * важны, и обе уже ломались. Создание не должно зависеть от текущего тела: постоянный ключ
 * идемпотентности, встретивший изменившееся тело, — это `idempotency_key_reused`, на котором
 * стенд не поднимается вовсе. А поле, выпавшее из сравнения, тихо не доедет до уже засеянной
 * базы: стенд покажет прежний контент и будет выглядеть исправным.
 */
async function ensureSeededMaterial(
  seed: SeedContext,
  definition: SeededMaterialDefinition,
): Promise<{ readonly contentVersion: number; readonly materialId: string }> {
  const { authoring, prisma, videos } = seed;
  const metadata = definition.metadata;
  const title = metadata.title;
  const existing = await prisma.material.findFirst({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
    where: definition.slug === undefined
      ? { title }
      : { OR: [{ slug: definition.slug }, { title }] },
  });
  let materialId = existing?.id;
  if (materialId === undefined) {
    const created = await authoring.createDraft({
      actor,
      body: definition.body,
      idempotencyKey: definition.createIdempotencyKey,
      metadata,
    });
    if (!created.ok) {
      throw new Error(`Local seed draft failed for ${title}: ${created.error.code}`);
    }
    materialId = created.value.materialId;
  }
  let primaryVideoId: string | null = null;
  if (definition.providerVideoId !== undefined) {
    const attached = await videos.attachExisting({
      access: "free",
      actor,
      materialId,
      providerVideoId: definition.providerVideoId,
    });
    if (!attached.ok) {
      throw new Error(`Local seed video failed for ${title}: ${attached.error.code}`);
    }
    primaryVideoId = attached.value.videoId;
  }
  const loaded = await authoring.loadMaterial({ actor, materialId });
  if (!loaded.ok) {
    throw new Error(`Local seed load failed for ${title}: ${loaded.error.code}`);
  }
  const current = loaded.value.metadata;
  const matchesDefinition =
    loaded.value.publicationState === "published" &&
    loaded.value.primaryVideoId === primaryVideoId &&
    current.access === metadata.access &&
    current.difficulty === metadata.difficulty &&
    current.formatId === metadata.formatId &&
    current.summary === metadata.summary &&
    current.title === title &&
    current.topicId === metadata.topicId &&
    isDeepStrictEqual(current.outcomes, metadata.outcomes) &&
    sameIdentifierSet(current.tagIds, metadata.tagIds) &&
    sameIdentifierSet(
      current.seriesMemberships.map(({ seriesId: value }) => value),
      metadata.seriesIds,
    ) &&
    isDeepStrictEqual(loaded.value.body, definition.body);
  if (matchesDefinition) {
    return { contentVersion: loaded.value.contentVersion, materialId };
  }
  const saved = await authoring.saveMaterial({
    actor,
    body: definition.body,
    expectedContentVersion: loaded.value.contentVersion,
    idempotencyKey:
      `${definition.saveIdempotencyKeyPrefix}-${String(loaded.value.contentVersion)}`,
    materialId,
    metadata,
    primaryVideoId,
    publicationState: "published",
  });
  if (!saved.ok) {
    throw new Error(`Local seed Save failed for ${title}: ${saved.error.code}`);
  }
  return { contentVersion: saved.value.contentVersion, materialId };
}

/** Теги и серии хранятся упорядоченными по идентификатору, а определение их не сортирует. */
function sameIdentifierSet(
  current: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    current.length === expected.length &&
    expected.every((value) => current.includes(value))
  );
}

async function ensureDevelopmentSeriesOrder(
  authoring: ReturnType<typeof assembleMaterials>["authoring"],
  seriesIdValue: string,
  orderedMaterialIds: readonly string[],
  stepGroups?: Readonly<Record<string, string>>,
): Promise<void> {
  const current = await authoring.loadSeriesOrder({ actor, seriesId: seriesIdValue });
  if (!current.ok) {
    throw new Error(`Local Series demo order load failed: ${current.error.code}`);
  }
  if (
    current.value.items.map(({ materialId }) => materialId).join(",") ===
    orderedMaterialIds.join(",") && stepGroups === undefined
  ) {
    return;
  }
  const reordered = await authoring.reorderSeries({
    actor,
    expectedOrderVersion: current.value.orderVersion,
    orderedMaterialIds,
    stepGroups,
    seriesId: seriesIdValue,
  });
  if (!reordered.ok) {
    throw new Error(`Local Series demo reorder failed: ${reordered.error.code}`);
  }
}

function requiredMaterialId(
  materialIds: ReadonlyMap<string, string>,
  slugValue: string,
): string {
  const value = materialIds.get(slugValue);
  if (value === undefined) throw new Error(`Local Series demo Material ${slugValue} is missing`);
  return value;
}

async function ensureCatalogContinuationMaterials(seed: SeedContext): Promise<void> {
  for (let index = 1; index <= 11; index += 1) {
    const sequence = String(index).padStart(2, "0");
    const nodeId = `73000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const metadata = {
        title: `Архитектурная заметка ${sequence}`,
        summary: "Дополнительный published Material для проверки infinite catalog.",
        access: "free" as const,
        difficulty: null,
        outcomes: [],
        topicId,
        formatId,
        tagIds: [],
        seriesIds: [],
      };
    const body = {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: `Материал ${sequence}.` }],
            },
          ],
        },
      } as const;
    await ensureSeededMaterial(seed, {
      body,
      createIdempotencyKey: `local-catalog-create-${sequence}`,
      metadata,
      saveIdempotencyKeyPrefix: `local-catalog-publish-${sequence}`,
      slug: `arkhitekturnaya-zametka-${sequence}`,
    });
  }
}

async function ensureHomeMaterials(seed: SeedContext): Promise<void> {
  const { authoring } = seed;
  const materials = [
    {
      formatId: videoFormatId,
      slug: "video-pro-developer-pipeline",
      summary: "Короткий разбор пути задачи от ready до проверяемой поставки.",
      title: "Видео про Developer Pipeline",
      providerVideoId: "local-home-developer-pipeline",
    },
    {
      formatId: videoFormatId,
      slug: "video-pro-glubokie-moduli",
      summary: "Как сделать интерфейс модуля компактным, а реализацию — глубокой.",
      title: "Глубокие модули на практике",
      providerVideoId: "local-home-deep-modules",
    },
    {
      formatId: videoFormatId,
      slug: "video-pro-produkty-i-kontekst",
      summary: "Как продуктовый контекст помогает принимать инженерные решения.",
      title: "Продукт и инженерный контекст",
      providerVideoId: "local-home-product-context",
    },
    {
      formatId: noteFormatId,
      slug: "zametka-pro-granitsy-modulya",
      summary: "Короткая памятка о границах ответственности в коде.",
      title: "Границы хорошего модуля",
    },
    {
      formatId: noteFormatId,
      slug: "zametka-pro-proveryaemuyu-postavku",
      summary: "Что должно быть доказано до передачи результата владельцу.",
      title: "Проверяемая поставка",
    },
    { formatId: noteFormatId, slug: "tekst-dlya-proverki-progressa", title: "Текст для проверки прогресса", summary: "Открытый текст для проверки ручной отметки." },
    { formatId, slug: "gayd-dlya-proverki-progressa", title: "Гайд для проверки прогресса", summary: "Последний материал демонстрационной серии." },
  ] as const;

  const progressSlugs = ["tekst-dlya-proverki-progressa", "video-pro-developer-pipeline", "gayd-dlya-proverki-progressa"];
  const progressIds = new Map<string, string>();
  for (const [index, materialDefinition] of materials.entries()) {
    const metadata = {
      access: "free" as const,
      difficulty: null,
      formatId: materialDefinition.formatId,
      outcomes: [],
      seriesIds: progressSlugs.includes(materialDefinition.slug) ? [progressSeriesId] : [],
      summary: materialDefinition.summary,
      tagIds: [tagId],
      title: materialDefinition.title,
      topicId,
    };
    const body = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            attrs: {
              nodeId: `74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            },
            content: [{ type: "text", text: materialDefinition.summary }],
            type: "paragraph",
          },
        ],
      },
    } as const;
    const seeded = await ensureSeededMaterial(seed, {
      body,
      createIdempotencyKey: `local-home-create-${String(index + 1)}`,
      metadata,
      saveIdempotencyKeyPrefix: `local-home-publish-v3-${String(index + 1)}`,
      slug: materialDefinition.slug,
      ...("providerVideoId" in materialDefinition
        ? { providerVideoId: materialDefinition.providerVideoId }
        : {}),
    });
    progressIds.set(materialDefinition.slug, seeded.materialId);
  }
  await ensureDevelopmentSeriesOrder(authoring, progressSeriesId, progressSlugs.map((slug) => requiredMaterialId(progressIds, slug)));
}

const localDevelopmentVideoProvider: VideoProvider = {
  delete() {
    return Promise.resolve({ kind: "not_found" });
  },
  find({ id, projectId }) {
    const fixture = localVideoFixtures.get(id);
    if (fixture === undefined || projectId !== localVideoProjects.free) return Promise.resolve(null);
    return Promise.resolve({
      durationSeconds: fixture.durationSeconds,
      embedLocator: `https://kinescope.io/embed/${id}`,
      id,
      projectId,
      status: "done",
      title: fixture.title,
    });
  },
  initUpload() {
    return Promise.reject(new Error("Local development seed does not upload videos"));
  },
};

async function ensureMembershipCatalogMaterial(seed: SeedContext): Promise<void> {
  const metadata = {
      title: "Developer Pipeline без потери контекста",
      summary: "Закрытый Material с публичным безопасным описанием для каталога.",
      access: "membership" as const,
      difficulty: null,
      outcomes: [],
      topicId,
      formatId,
      tagIds: [tagId],
      seriesIds: [seriesId],
    };
  const body = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000035" },
            content: [{ type: "text", text: "Закрытое содержимое для участников." }],
          },
        ],
      },
    } as const;
  await ensureSeededMaterial(seed, {
    body,
    createIdempotencyKey: membershipCreateIdempotencyKey,
    metadata,
    saveIdempotencyKeyPrefix: "local-membership-publish",
    slug: membershipSlug,
  });
}

async function ensureRelatedPin(
  prisma: PlatformPrisma,
  sourceMaterialId: string,
): Promise<void> {
  const target = await prisma.material.findUnique({
    where: { slug: "arkhitekturnaya-zametka-01" },
    select: { id: true },
  });
  if (target === null) {
    throw new Error("Local related Material target is missing");
  }
  await prisma.materialRelatedPin.upsert({
    where: {
      sourceMaterialId_targetMaterialId: {
        sourceMaterialId,
        targetMaterialId: target.id,
      },
    },
    create: {
      sourceMaterialId,
      targetMaterialId: target.id,
      ordinal: 1,
    },
    update: { ordinal: 1 },
  });
}

async function ensureReferenceData(prisma: PlatformPrisma): Promise<void> {
  await prisma.topic.upsert({
    where: { id: topicId },
    create: {
      id: topicId,
      slug: "platform",
      name: "Platform",
      summary: "Архитектура продукта, bounded contexts и управляемая поставка.",
    },
    update: {
      summary: "Архитектура продукта, bounded contexts и управляемая поставка.",
    },
  });
  await prisma.tag.upsert({
    where: { id: tagId },
    create: {
      id: tagId,
      name: "Full stack",
      normalizedName: "full stack",
    },
    update: {},
  });
  await prisma.guide.upsert({
    where: { id: seriesId },
    create: {
      id: seriesId,
      slug: "platform-inside",
      name: "Создание Platform Inside",
      summary: "Путь от продуктовой идеи до работающей Platform.",
    },
    update: { summary: "Путь от продуктовой идеи до работающей Platform." },
  });
  for (const data of [
    { id: progressSeriesId, slug: "demo-progress-series", name: "Demo · Прогресс обучения", summary: "Текст, видео и гайд для проверки сохранённого прогресса." },
    { id: demoStepsSeriesId, slug: "demo-series-release", name: "Demo · Релиз своего проекта", summary: "Одна серия: видео, заметки и три связанных шага инструкции. Тестовые материалы для проверки интерфейса." },
    { id: demoStepsSharedSeriesId, slug: "demo-series-release-shared", name: "Учебный пример · Подготовка проекта", summary: "Тот же гайд в другой серии без отметки последовательности шагов." },
  ]) {
    await prisma.guide.upsert({ where: { id: data.id }, create: data, update: { name: data.name } });
  }
  await prisma.guide.upsert({
    where: { id: demoHarnessSeriesId },
    create: {
      id: demoHarnessSeriesId,
      slug: "demo-series-harness",
      name: "Demo #295 · основная серия",
      summary: "Development-образец A → B для проверки выбранного контекста. Не является контентом Кирилла.",
    },
    update: {},
  });
  await prisma.guide.upsert({
    where: { id: demoReviewSeriesId },
    create: {
      id: demoReviewSeriesId,
      slug: "demo-series-review",
      name: "Demo #295 · смешанная серия",
      summary: "Development-образец гайд → видео → заметка. Не является контентом Кирилла.",
    },
    update: {},
  });
}
