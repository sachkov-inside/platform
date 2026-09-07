import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, within, userEvent } from "storybook/test";

import { ReadingAction } from "@/features/reading-progress";
import { ApplicationShell } from "@/widgets/application-shell";
import type { ContinueMaterialView, PersonalHomeView } from "../model/personal-home-view";
import { ContinueLearning } from "./continue-learning";
import { HomePage } from "./home-page";
import { illustratedHome } from "./illustrated-home.fixture";

const text: ContinueMaterialView = { id: "text", slug: "kak-ustroen-inside-platform", title: "Как устроен Inside Platform", format: "Гайд", resume: { kind: "start" } };
const video: ContinueMaterialView = { id: "video", slug: "video-pro-developer-pipeline", title: "Developer Pipeline: от идеи до работающего продукта", format: "Видео", resume: { kind: "position", positionSeconds: 754 } };
const ended: ContinueMaterialView = { id: "ended", slug: "granitsy-khoroshego-modulya", title: "Как выбрать границы модуля", format: "Видео", resume: { kind: "reached-end" } };

function PersonalHomeProof({ view }: { readonly view: PersonalHomeView }) {
  const [completed, setCompleted] = useState<readonly string[]>([]);
  const [retried, setRetried] = useState(false);
  const current: PersonalHomeView = retried ? { kind: "ready", items: [text] } : view.kind === "ready" ? { kind: "ready", items: view.items.filter((item) => !completed.includes(item.id)) } : view;
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const refresh = () => { setRefreshing(true); };
    window.addEventListener("personal-home-proof-refresh", refresh);
    return () => { window.removeEventListener("personal-home-proof-refresh", refresh); };
  }, []);
  const presented: PersonalHomeView = refreshing && (current.kind === "ready" || current.kind === "unavailable") ? { kind: "loading", previous: current } : current;
  return <HomePage result={{ kind: "ready", value: illustratedHome }} personal={<ContinueLearning view={presented} onRetry={() => { setRetried(true); }} readingActions={new Map([[ended.id, <ReadingAction key={ended.id} format="Видео" view={{ kind: "ready", isRead: false, canMark: true }} onRefresh={() => undefined} onSetReadingState={() => { setCompleted([...completed, ended.id]); }} />]])} />} />;
}
const meta = {
  component: PersonalHomeProof,
  title: "Pages/Personal Home",
  decorators: [(Story) => <ApplicationShell currentPath="/" mobileNavigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }, { href: "/account", icon: "profile", label: "Профиль" }]} navigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }]}><Story /></ApplicationShell>],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PersonalHomeProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Anonymous: Story = { args: { view: { kind: "hidden" } } };
export const SignedInEmpty: Story = { args: { view: { kind: "ready", items: [] } } };
export const FreeNonMember: Story = { args: { view: { kind: "ready", items: [text] } } };
export const Member: Story = { args: { view: { kind: "ready", items: [video, text, ended] } } };
export const Expired: Story = { args: { view: { kind: "ready", items: [text] } } };
export const TextWithoutPosition: Story = { args: { view: { kind: "ready", items: [text] } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(canvas.getByRole("region", { name: "Продолжить изучение" })).toHaveTextContent("Открыть материал"); } };
export const PartialVideo: Story = { args: { view: { kind: "ready", items: [video] } }, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByText("Продолжить с 12:34")).toBeVisible(); } };
export const ReachedEndUnmarked: Story = { args: { view: { kind: "ready", items: [ended, text] } } };
export const CompletedExclusion: Story = { args: { view: { kind: "ready", items: [ended, text] } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: /^Просмотрено$/u })); await expect(canvas.queryByText(ended.title)).not.toBeInTheDocument(); await expect(canvas.getByRole("heading", { name: "Серии" })).toBeVisible(); } };
export const PartialData: Story = { args: { view: { kind: "ready", items: [{ ...video, resume: { kind: "start" } }, text] } } };
export const Loading: Story = { args: { view: { kind: "loading", previous: { kind: "ready", items: [video, text, ended] } } } };
export const Unavailable: Story = { args: { view: { kind: "unavailable" } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(canvas.getByRole("heading", { name: "Серии" })).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Попробовать ещё раз" })); await expect(canvas.queryByRole("status")).not.toBeInTheDocument(); } };
