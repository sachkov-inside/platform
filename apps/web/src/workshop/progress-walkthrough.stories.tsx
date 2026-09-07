import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type MouseEvent } from "react";
import { expect, userEvent, within } from "storybook/test";

import { ContinueLearning, HomePage, type ContinueMaterialView } from "@/_pages/home";
import { illustratedHome } from "@/_pages/home/ui/illustrated-home.fixture";
import { LibraryDiscoveryView } from "@/_pages/library-discovery";
import { MaterialReaderView, type MaterialReaderMetadata, type ReaderBlock } from "@/_pages/material-reader";
import { MaterialCard, MaterialReadingContext, type MaterialPreview } from "@/entities/material";
import { ReadingAction, SeriesProgress, type ReadingActionView } from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";
import { ApplicationShell, type ApplicationNavigationItem } from "@/widgets/application-shell";

const navigation = [{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }] satisfies readonly ApplicationNavigationItem[];
const materials = [
  { id: "text", slug: "reliable-requests", title: "Почему повтор запроса не должен повторять действие", format: "Текст", resume: { kind: "start" } },
  { id: "video", slug: "video-pro-developer-pipeline", title: "От задачи до релиза: Developer Pipeline", format: "Видео", resume: { kind: "position", positionSeconds: 754 } },
  { id: "guide", slug: "kak-ustroen-inside-platform", title: "Как устроен Inside Platform", format: "Гайд", resume: { kind: "start" } },
] as const satisfies readonly ContinueMaterialView[];
const body: readonly ReaderBlock[] = [{ kind: "paragraph", content: [{ kind: "text", marks: [], text: "Сервер сохранил изменение, но ответ потерялся. Повтор запроса должен вернуть результат той же команды. Так временный сбой соединения не превращается в повторное действие." }] }];
const register = () => () => undefined;
const refresh = () => Promise.resolve();
const surfaces = { home: "Главная", reader: "Материал", series: "Серия", cards: "Карточки" } as const;
type Surface = keyof typeof surfaces;

function preview(item: ContinueMaterialView): MaterialPreview {
  const cover = item.id === "video" ? illustratedHome.videos[2]?.cover : illustratedHome.guides[1]?.cover;
  return { materialId: item.id, slug: item.slug, title: item.title, format: item.format,
    summary: "Практический разбор: от понятных границ к работающему приложению.",
    access: "free", availability: "available", cover: cover ?? null,
    topic: "Архитектура", topicSlug: "platform", tags: [], seriesMemberships: [] };
}

/** Story-only state ties the existing presentation components together; it never calls the API. */
function ProgressWalkthrough({ initialRead = [], initialSurface = "home", failFirstSave = false, videoEnded = false }: {
  readonly initialRead?: readonly string[];
  readonly initialSurface?: Surface;
  readonly failFirstSave?: boolean;
  readonly videoEnded?: boolean;
}) {
  const [read, setRead] = useState(initialRead);
  const [surface, setSurface] = useState(initialSurface);
  const [selectedId, setSelectedId] = useState("text");
  const [failure, setFailure] = useState<{ readonly id: string; readonly desired: boolean } | null>(null);
  const [shouldFail, setShouldFail] = useState(failFirstSave);
  const items: readonly ContinueMaterialView[] = materials.map((item) => item.id === "video" && videoEnded ? { ...item, resume: { kind: "reached-end" } } : item);
  const selected = items.find((item) => item.id === selectedId) ?? materials[0];
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
    const path = new URL(anchor.href).pathname;
    const item = items.find((candidate) => path === `/materials/${candidate.slug}`);
    if (item !== undefined) { event.preventDefault(); setSelectedId(item.id); navigate("reader"); }
    else if (path === "/" || path === "/library" || path.startsWith("/series/") || path.startsWith("/topics/")) {
      event.preventDefault(); navigate(path === "/" ? "home" : path.startsWith("/series/") ? "series" : "cards");
    }
  };
  const metadata: MaterialReaderMetadata = {
    materialId: selected.id, contentVersion: 1, access: "free", cover: null,
    format: { name: selected.format, slug: selected.id }, publishedAt: "2026-09-07T09:00:00.000Z",
    slug: selected.slug, title: selected.title, summary: "Разберём на примере, как сохранить результат, даже если ответ сервера потерялся.",
    tags: [], topic: { name: "Архитектура", slug: "platform" }, seriesMemberships: [],
  };
  return <>
    <aside aria-label="Проверка прогресса в Storybook" className="border-b border-border bg-muted px-4 py-4 text-sm">
      <div className="mx-auto max-w-6xl">
        <p className="font-semibold">Проверка прогресса · демонстрационные данные</p>
        <p className="mt-1 text-muted-foreground">Откройте материал, поставьте отметку и сравните главную, серию и карточки. Все три материала уже открывались. После снятия отметки материал вернётся на главную.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.entries(surfaces) as [Surface, string][]).map(([value, label]) => <Button aria-pressed={surface === value} key={value} size="sm" variant={surface === value ? "default" : "outline"} onClick={() => { navigate(value); }}>{label}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => { setRead(initialRead); setFailure(null); setShouldFail(failFirstSave); setSelectedId("text"); navigate(initialSurface); }}>Сбросить пример</Button>
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
          {surface === "home" ? <HomePage result={{ kind: "ready", value: { ...illustratedHome, videos: [preview(materials[1])], guides: [preview(materials[2])], notes: [], playlists: [{ id: "series", slug: "ot-koda-do-reliza", name: "От кода до релиза", summary: "Изменение, проверка, выпуск: собираем надёжный путь поставки.", cover: null, count: 3, previewItems: materials.map(preview) }] } }} personal={<ContinueLearning view={{ kind: "ready", items: items.filter((item) => !read.includes(item.id)) }} readingActions={new Map(items.map((item) => [item.id, action(item)]))} />} /> : null}
          {surface === "reader" ? <MaterialReaderView body={body} material={metadata} primaryVideo={null} readingAction={action(selected)} /> : null}
          {surface === "series" ? <LibraryDiscoveryView result={{ kind: "ready", discoveryKind: "series", hasNext: false, reference: { name: "От кода до релиза", slug: "ot-koda-do-reliza", summary: "Изменение, проверка, выпуск: собираем надёжный путь поставки." }, items: materials.map(preview), relatedSeries: [], topics: [] }} seriesProgress={<SeriesProgress view={{ kind: "ready", total: materials.length, read: read.length }} />} /> : null}
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
  parameters: { controls: { disable: true }, docs: { description: { component: "Связанный визуальный сценарий #329–#332. Верхняя панель относится только к Storybook. Ниже используются компоненты Platform: Reader, ReadingAction, MaterialCard, SeriesProgress, HomePage и ContinueLearning. Отметки меняются только в памяти примера. Дополнительные состояния: Pages/Reading progress и Pages/Personal Home." } } },
} satisfies Meta<typeof ProgressWalkthrough>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = { name: "1. Проверить весь путь" };
export const Completed: Story = { name: "2. Всё изучено", args: { initialRead: ["text", "video", "guide"], initialSurface: "series" } };
export const SaveFailure: Story = { name: "3. Ошибка сохранения", args: { initialSurface: "reader", failFirstSave: true } };
export const VideoEnded: Story = { name: "4. Видео досмотрено", args: { videoEnded: true } };
export const CheckConnections: Story = { name: "Проверка связей", play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const toolbar = within(canvas.getByRole("complementary", { name: "Проверка прогресса в Storybook" }));
  await userEvent.click(canvas.getByRole("link", { name: /Текст Почему повтор запроса/u }));
  await userEvent.click(canvas.getByRole("button", { name: "Прочитано" }));
  await userEvent.click(toolbar.getByRole("button", { name: "Серия" }));
  await expect(canvas.getByText("Изучено 1 из 3")).toBeVisible();
  await expect(canvas.getByText("Прочитано", { exact: true })).toBeVisible();
  await userEvent.click(toolbar.getByRole("button", { name: "Главная" }));
  await expect(canvas.queryByText(materials[0].title)).not.toBeInTheDocument();
  await userEvent.click(toolbar.getByRole("button", { name: "Материал" }));
  await userEvent.click(canvas.getByRole("button", { name: "Прочитано" }));
  await userEvent.click(toolbar.getByRole("button", { name: "Главная" }));
  await expect(canvas.getByText(materials[0].title)).toBeVisible();
} };
