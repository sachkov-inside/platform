import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type MouseEvent } from "react";
import { expect, userEvent, within } from "storybook/test";

import { HomePage, type HomeCollection, type HomeContinuation, type ContinueMaterialView } from "@/_pages/home";
import { illustratedHome } from "@/_pages/home/ui/illustrated-home.fixture";
import { LibraryDiscoveryView } from "@/_pages/library-discovery";
import { MaterialReaderView, type MaterialReaderMetadata, type ReaderBlock } from "@/_pages/material-reader";
import { resolveSeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { MaterialCard, MaterialReadingContext, type MaterialPreview } from "@/entities/material";
import { ReadingAction, type ReadingActionView } from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { ApplicationShell, type ApplicationNavigationItem } from "@/widgets/application-shell";

const navigation = [{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }] satisfies readonly ApplicationNavigationItem[];
const materials = [
  { id: "text", slug: "reliable-requests", title: "Почему повтор запроса не должен повторять действие", format: "Текст", resume: { kind: "start" } },
  { id: "video", slug: "video-pro-developer-pipeline", title: "От задачи до релиза: Developer Pipeline", format: "Видео", resume: { kind: "position", positionSeconds: 243 } },
  { id: "guide", slug: "kak-ustroen-inside-platform", title: "Как устроен Inside Platform", format: "Гайд", resume: { kind: "start" } },
] as const satisfies readonly ContinueMaterialView[];
const body: readonly ReaderBlock[] = [{ kind: "paragraph", content: [{ kind: "text", marks: [], text: "Сервер сохранил изменение, но ответ потерялся. Повтор запроса должен вернуть результат той же команды. Так временный сбой соединения не превращается в повторное действие." }] }];
const register = () => () => undefined;
const refresh = () => Promise.resolve();
const surfaces = { home: "Главная", reader: "Материал", series: "Руководство", cards: "Карточки" } as const;
type Surface = keyof typeof surfaces;

function preview(item: ContinueMaterialView): MaterialPreview {
  const cover = item.id === "video" ? illustratedHome.videos[2]?.cover : illustratedHome.guides[1]?.cover;
  return { materialId: item.id, slug: item.slug, title: item.title, format: item.format,
    summary: "Практический разбор: от понятных границ к работающему приложению.",
    access: "free", availability: "available", cover: cover ?? null,
    ...(item.id === "video" ? { primaryVideoDurationSeconds: 628 } : {}),
    topic: "Архитектура", topicSlug: "platform", tags: [], seriesMemberships: [] };
}

/** Story-only state ties the existing presentation components together; it never calls the API. */
function ProgressWalkthrough({ initialRead = ["text"], initialSurface = "home", failFirstSave = false, videoEnded = false, hasHistory = true }: {
  readonly initialRead?: readonly string[];
  readonly initialSurface?: Surface;
  readonly failFirstSave?: boolean;
  readonly videoEnded?: boolean;
  readonly hasHistory?: boolean;
}) {
  const [read, setRead] = useState(initialRead);
  const [surface, setSurface] = useState(initialSurface);
  const [selectedId, setSelectedId] = useState("text");
  const [readerFromSeries, setReaderFromSeries] = useState(false);
  const [failure, setFailure] = useState<{ readonly id: string; readonly desired: boolean } | null>(null);
  const [shouldFail, setShouldFail] = useState(failFirstSave);
  const items: readonly ContinueMaterialView[] = materials.map((item) => item.id === "video" && videoEnded ? { ...item, resume: { kind: "reached-end" } } : item);
  const selected = items.find((item) => item.id === selectedId) ?? materials[0];
  const collection: HomeCollection = { id: "series", slug: "platform-inside", name: "Создание Platform Inside", summary: "Путь от продуктовой идеи до работающей Platform.", cover: illustratedHome.playlists[1]?.cover ?? null, count: materials.length, previewItems: materials.map(preview) };
  const next = materials.find((item) => !read.includes(item.id));
  const continuation: HomeContinuation = {
    ...(hasHistory && next !== undefined ? { series: { collection, read: read.length, total: materials.length } } : {}),
    ...(hasHistory && !videoEnded && !read.includes("video") ? { video: { material: preview(materials[1]), label: "Продолжить с 4:03" } } : {}),
  };

  const states = new Map(materials.map((item) => [item.id, { isRead: read.includes(item.id), version: 1 }]));
  const setReading = (id: string, desired: boolean) => {
    if (shouldFail) { setShouldFail(false); setFailure({ id, desired }); return; }
    setFailure(null);
    setRead((current) => desired ? [...current.filter((value) => value !== id), id] : current.filter((value) => value !== id));
  };
  const action = (item: ContinueMaterialView) => {
    const view: ReadingActionView = failure?.id === item.id
      ? { kind: "error", isRead: read.includes(item.id), canMark: true, desiredIsRead: failure.desired }
      : { kind: "ready", isRead: read.includes(item.id), canMark: true };
    return <ReadingAction key={item.id} format={item.format} view={view} onSetReadingState={(desired) => { setReading(item.id, desired); }} onRefresh={() => { setFailure(null); }} />;
  };
  const navigate = (next: Surface) => { setSurface(next); window.scrollTo(0, 0); };
  const followLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (anchor === null) return;
    const url = new URL(anchor.href);
    const path = url.pathname;
    const item = items.find((candidate) => path === `/materials/${candidate.slug}`);
    if (item !== undefined) { event.preventDefault(); setSelectedId(item.id); setReaderFromSeries(/^\/(guides|series)\//u.test(url.searchParams.get("from") ?? "")); navigate("reader"); }
    else if (path === "/" || path === "/library" || /^\/(guides|series)\//u.test(path) || path.startsWith("/topics/")) {
      event.preventDefault(); navigate(path === "/" ? "home" : /^\/(guides|series)\//u.test(path) ? "series" : "cards");
    }
  };
  const metadata: MaterialReaderMetadata = {
    materialId: selected.id, contentVersion: 1, access: "free", cover: null,
    format: { name: selected.format, slug: selected.id }, publishedAt: "2026-09-07T09:00:00.000Z",
    slug: selected.slug, title: selected.title, summary: "Разберём на примере, как сохранить результат, даже если ответ сервера потерялся.",
    tags: [], topic: { name: "Архитектура", slug: "platform" }, seriesMemberships: [],
  };
  const returnTarget = parseMaterialReaderReturnTarget(readerFromSeries ? "/series/platform-inside" : "/");
  const seriesContext = resolveSeriesReaderContext({ currentMaterialSlug: selected.slug, returnTarget, series: { kind: "ready", reference: collection, items: materials } });
  return <>
    <aside aria-label="Проверка прогресса в Storybook" className="border-b border-border bg-muted px-4 py-4 text-sm">
      <div className="mx-auto max-w-6xl">
        <p className="font-semibold">Проверка прогресса · демонстрационные данные</p>
        <p className="mt-1 text-muted-foreground">Откройте материал, поставьте отметку и сравните главную, руководство и карточки. Продолжение встроено в обычные карточки руководства и видео; галочки показывают изученное.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.entries(surfaces) as [Surface, string][]).map(([value, label]) => <Button aria-pressed={surface === value} key={value} size="sm" variant={surface === value ? "default" : "outline"} onClick={() => { navigate(value); }}>{label}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => { setRead(initialRead); setFailure(null); setShouldFail(failFirstSave); setSelectedId("text"); setReaderFromSeries(false); navigate(initialSurface); }}>Сбросить пример</Button>
        </div>
        {surface === "reader" ? <div className="mt-3 flex flex-wrap gap-2" aria-label="Материал для проверки">
          {items.map((item) => <Button aria-pressed={selected.id === item.id} key={item.id} size="sm" variant="outline" onClick={() => { setSelectedId(item.id); }}>{item.format}</Button>)}
          {selected.id === "video" ? <p className="w-full text-xs text-muted-foreground">Здесь проверяется отметка видео. Сам плеер и сохранение позиции проверены отдельно; видео в этом примере не воспроизводится.</p> : null}
        </div> : null}
      </div>
    </aside>
    <div onClickCapture={followLink}>
      <MaterialReadingContext value={{ accountId: "storybook-account", resolved: true, states, failed: false, register, refresh }}>
        <ApplicationShell currentPath={surface === "home" ? "/" : "/library"} navigationItems={navigation} mobileNavigationItems={navigation}>
          {surface === "home" ? <HomePage result={{ kind: "ready", value: { ...illustratedHome, videos: illustratedHome.videos.map((item) => item.slug === materials[1].slug ? preview(materials[1]) : item), guides: illustratedHome.guides.map((item) => item.slug === materials[2].slug ? preview(materials[2]) : item), playlists: illustratedHome.playlists.map((item) => item.slug === collection.slug ? collection : item) } }} continuation={continuation} /> : null}
          {surface === "reader" ? <MaterialReaderView body={body} material={metadata} primaryVideo={null} readingAction={action(selected)} returnTarget={returnTarget} seriesContext={seriesContext} /> : null}
          {surface === "series" ? <LibraryDiscoveryView learning={{ kind: "ready", total: materials.length, read: read.length, continuation: hasHistory && next !== undefined ? { materialSlug: next.slug, label: next.id === "video" && !videoEnded ? "Продолжить с 4:03" : "Продолжить здесь" } : null }} result={{ chapters: [], kind: "ready", discoveryKind: "series", hasNext: false, reference: { name: collection.name, slug: collection.slug, summary: collection.summary ?? "" }, items: materials.map(preview), relatedSeries: [], topics: [] }} /> : null}
          {surface === "cards" ? <div className="mx-auto max-w-5xl">
            <h1 className="text-2xl font-semibold">Карточки материалов</h1>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {materials.map((item) => <MaterialCard key={item.id} material={preview(item)} />)}
            </div>
          </div> : null}
        </ApplicationShell>
      </MaterialReadingContext>
    </div>
  </>;
}

const meta = {
  title: "Pages/Progress walkthrough", component: ProgressWalkthrough,
  parameters: { controls: { disable: true }, docs: { description: { component: "Связанный визуальный сценарий #329–#332. Верхняя панель относится только к Storybook. Ниже используются компоненты Platform: Reader, ReadingAction, MaterialCard, SeriesProgress, HomePage, PlaylistCard и MaterialCard. Начатое руководство и недосмотренное видео стоят первыми в своих секциях без отдельных карточек продолжения. Отметки меняются только в памяти примера. Отметки и их ошибки: Pages/Reading progress. Прежний отдельный блок Pages/Personal Home заменён этим предложением; Реальные Home и Series получают продолжение через private API; этот пример использует только демонстрационные данные." } } },
} satisfies Meta<typeof ProgressWalkthrough>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = { name: "1. Проверить весь путь" };
export const Completed: Story = { name: "2. Всё изучено", args: { initialRead: ["text", "video", "guide"], initialSurface: "series" } };
export const SaveFailure: Story = { name: "3. Ошибка сохранения", args: { initialRead: [], initialSurface: "reader", failFirstSave: true } };
export const VideoEnded: Story = { name: "4. Видео досмотрено", args: { videoEnded: true } };
export const NoHistory: Story = { name: "5. Без истории", args: { initialRead: [], hasHistory: false } };
export const CheckConnections: Story = { name: "Проверка связей", play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const toolbar = within(canvas.getByRole("complementary", { name: "Проверка прогресса в Storybook" }));
  await expect(canvas.queryByRole("region", { name: "Продолжить изучение" })).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole("link", { name: "Продолжить руководство Создание Platform Inside" }));
  await expect(canvas.getByRole("list", { name: "Материалы руководства" })).toBeVisible();
  await expect(canvasElement.querySelector('[aria-current="step"]')).toHaveTextContent(materials[1].title);
  await userEvent.click(canvas.getByRole("link", { name: materials[1].title }));
  await expect(canvas.getByRole("heading", { name: materials[1].title })).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Просмотрено" }));
  await userEvent.click(toolbar.getByRole("button", { name: "Руководство" }));
  await expect(canvas.getByText("Изучено 2 из 3")).toBeVisible();
  await expect(canvas.getByRole("img", { name: "Материал 1, изучен" })).toBeVisible();
  await expect(canvas.getByRole("img", { name: "Материал 2, изучен" })).toBeVisible();
  await userEvent.click(toolbar.getByRole("button", { name: "Главная" }));
  await expect(canvas.queryByText("Продолжить с 4:03")).not.toBeInTheDocument();
  await expect(canvas.getByRole("link", { name: "Продолжить руководство Создание Platform Inside" })).toHaveAttribute("href", expect.stringContaining("/guides/platform-inside"));
  await userEvent.click(canvas.getByRole("link", { name: "Продолжить руководство Создание Platform Inside" }));
  await expect(canvasElement.querySelector('[aria-current="step"]')).toHaveTextContent(materials[2].title);
  await userEvent.click(toolbar.getByRole("button", { name: "Материал" }));
  await userEvent.click(canvas.getByRole("button", { name: "Просмотрено" }));
  await userEvent.click(toolbar.getByRole("button", { name: "Главная" }));
  await expect(canvas.getByText("Продолжить с 4:03")).toBeVisible();
} };
