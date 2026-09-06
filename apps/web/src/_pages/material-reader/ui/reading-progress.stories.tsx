import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { MaterialReaderView, type MaterialReaderMetadata, type ReaderBlock } from "@/_pages/material-reader";
import { MaterialCard, MaterialReadingStatus, type MaterialPreview } from "@/entities/material";
import { ApplicationShell, type ApplicationNavigationItem } from "@/widgets/application-shell";
import { ReadingAction, SeriesProgress, type ReadingActionView } from "@/features/reading-progress";

const navigation = [{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }] satisfies readonly ApplicationNavigationItem[];
const metadata: MaterialReaderMetadata = {
  materialId: "02000000-0000-4000-8000-000000000010", contentVersion: 1, access: "free", cover: null,
  format: { name: "Текст", slug: "text" }, publishedAt: "2026-09-06T12:00:00.000Z", seriesMemberships: [],
  slug: "reliable-requests", title: "Почему повтор запроса не должен повторять действие",
  summary: "Разберём на примере, как сохранить результат, даже если ответ сервера потерялся.",
  tags: [], topic: { name: "Проектирование систем", slug: "system-design" },
};
const body: readonly ReaderBlock[] = [{ kind: "paragraph", content: [{ kind: "text", marks: [], text: "Сервер сохранил отметку, но соединение оборвалось раньше, чем пришёл ответ. При повторе запроса он находит результат той же команды и возвращает его. Новая запись не появляется, а история остаётся точной." }] }];
const preview: MaterialPreview = {
  access: "free", availability: "available", format: "Текст", slug: metadata.slug,
  summary: metadata.summary, title: metadata.title, topic: metadata.topic.name, topicSlug: metadata.topic.slug,
  seriesMemberships: [], tags: [],
};

function ReadingProof({ initial = { kind: "ready", isRead: false, canMark: true }, format = "text", surface = "reader", total = 6, read = 2 }: {
  readonly initial?: ReadingActionView;
  readonly format?: string;
  readonly surface?: "reader" | "cards" | "series";
  readonly total?: number;
  readonly read?: number;
}) {
  const [view, setView] = useState(initial);
  const isRead = "isRead" in view && view.isRead;
  const displayedRead = read + (isRead ? 1 : 0);
  const onSetReadingState = (desiredIsRead: boolean) => {
    if (!("isRead" in view)) return;
    setView({ kind: "pending", isRead: view.isRead, canMark: view.canMark, desiredIsRead });
    // Fixture response only: production supplies the same presentation interface in #329.
    setTimeout(() => { setView({ kind: "ready", isRead: desiredIsRead, canMark: view.canMark }); }, 350);
  };
  const action = <ReadingAction format={format} view={view} onSetReadingState={onSetReadingState} onRefresh={() => { setView({ kind: "ready", isRead, canMark: true }); }} />;
  const progress = <div className="mt-5"><SeriesProgress view={{ kind: "ready", total, read: displayedRead }} /></div>;
  const formatName = format === "video" ? "Видео" : format === "text" ? "Текст" : "Гайд";
  return <ApplicationShell currentPath="/library" navigationItems={navigation} mobileNavigationItems={navigation}>
    {surface === "reader" ? <MaterialReaderView body={body} material={{ ...metadata, format: { name: formatName, slug: format } }} primaryVideo={format === "video" ? { state: "ready", videoId: "02000000-0000-4000-8000-000000000015", title: metadata.title } : null} readingAction={action} /> :
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold">{surface === "series" ? "Надёжное приложение" : "Изученные материалы"}</h1>
        <p className="mt-3 text-muted-foreground">{surface === "series" ? "От первого запроса до устойчивой работы в продакшене." : "Одна отметка видна в базе знаний, теме, серии и на главной."}</p>
        {progress}
        {surface === "cards" ? <div className="mt-8 grid gap-8 sm:grid-cols-2">
          {(["default", "compact", "row", "feed"] as const).map((variant) => <div key={variant}><MaterialCard material={{ ...preview, format: formatName }} variant={variant} readingStatus={<MaterialReadingStatus format={format} isRead={isRead} />} /></div>)}
        </div> : <div className="mt-6 grid gap-3">{total > 0 ? <MaterialCard material={preview} variant="row" readingStatus={<MaterialReadingStatus format={format} isRead={isRead} />} /> : <p className="text-muted-foreground">В этой серии пока нет опубликованных материалов.</p>}</div>}
        {total > 0 ? action : null}
      </div>}
  </ApplicationShell>;
}
const meta = {
  title: "Pages/Reading progress", component: ReadingProof,
  parameters: { docs: { description: { component: "#328: production-owned presentation proof. Reader actions, card status and current Series count; real persistence and transport are supplied by #329 after visual acceptance." } } },
} satisfies Meta<typeof ReadingProof>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = { args: { format: "text" } };
export const Video: Story = { args: { format: "video" } };
export const Guide: Story = { args: { format: "guide" } };
export const OtherFormat: Story = { args: { format: "unknown" } };
export const Anonymous: Story = { args: { initial: { kind: "anonymous", loginHref: "/sign-in" } } };
export const FreeNonMember: Story = { args: { initial: { kind: "ready", isRead: false, canMark: true } } };
export const Member: Story = { args: { initial: { kind: "ready", isRead: true, canMark: true } } };
export const ExpiredMarked: Story = { args: { initial: { kind: "ready", isRead: true, canMark: false } } };
export const UnavailableAccess: Story = { args: { initial: { kind: "ready", isRead: false, canMark: false } }, play: async ({ canvasElement }) => {
  const button = within(canvasElement).getByRole("button", { name: "Прочитано" });
  await expect(button).toHaveAttribute("aria-disabled", "true");
} };
export const Loading: Story = { args: { initial: { kind: "loading" } } };
export const Pending: Story = { args: { initial: { kind: "pending", isRead: false, canMark: true, desiredIsRead: true } } };
export const Failure: Story = { args: { initial: { kind: "error", isRead: false, canMark: true, desiredIsRead: true } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("alert")).toHaveTextContent("Не сохранено");
  await expect(canvas.getByRole("button", { name: "Прочитано" })).toHaveAttribute("aria-pressed", "false");
} };
export const Conflict: Story = { args: { initial: { kind: "conflict", isRead: true, canMark: true } } };
export const Cards: Story = { args: { surface: "cards", initial: { kind: "ready", isRead: true, canMark: true } } };
export const CardsMarkAndRemove: Story = { ...Cards, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getAllByText("Прочитано", { exact: true })).toHaveLength(5);
  await userEvent.click(canvas.getByRole("button", { name: "Прочитано" }));
  await waitFor(() => expect(canvas.queryAllByText("Прочитано", { exact: true })).toHaveLength(1));
  await expect(canvas.getByText("Изучено 2 из 6")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Прочитано" }));
  await waitFor(() => expect(canvas.getAllByText("Прочитано", { exact: true })).toHaveLength(5));
  await expect(canvas.getByText("Изучено 3 из 6")).toBeVisible();
} };
export const Series: Story = { args: { surface: "series" } };
export const CompleteSeries: Story = { args: { surface: "series", read: 5, initial: { kind: "ready", isRead: true, canMark: true } } };
export const EmptySeries: Story = { args: { surface: "series", read: 0, total: 0 }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText("Изучено 0 из 0")).toBeVisible();
  await expect(canvas.queryByText("Все материалы изучены")).not.toBeInTheDocument();
} };
export const MarkAndRemove: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const button = canvas.getByRole("button", { name: "Прочитано" });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  button.focus();
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
  await expect(button).toHaveFocus();
  await userEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
} };
