"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  FileCode2,
  GitBranch,
  Home,
  Layers3,
  LibraryBig,
  List,
  LockKeyhole,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { Sidebar, SidebarBody, SidebarToggle, useSidebar } from "@/shared/ui/sidebar";

import "./mobile-first-platform.prototype.css";

/**
 * THROWAWAY PROTOTYPE. Owner-selected magazine hierarchy for a combined mobile Home.
 * Question: how should Materials, Playlists, Topics and Notes share one editorial Home?
 * Assumption under review: a Note is a Material with the primary Format `note`.
 */

type PrototypeScreen = "home" | "library" | "material" | "playlist" | "profile" | "topic";
type NavigationScreen = "home" | "library" | "profile";
type MaterialFormat = "guide" | "note" | "video";
type CoverTone = "blue" | "coral" | "ink" | "lavender" | "mint" | "sand";
type Audience = "member" | "visitor";

interface MaterialFixture {
  readonly date: string;
  readonly duration: string;
  readonly excerpt: string;
  readonly format: MaterialFormat;
  readonly icon: LucideIcon;
  readonly id: string;
  readonly label: string;
  readonly new?: boolean;
  readonly access?: "membership";
  readonly tags: readonly string[];
  readonly title: string;
  readonly tone: CoverTone;
  readonly topic: string;
}

interface PlaylistFixture {
  readonly count: number;
  readonly description: string;
  readonly id: string;
  readonly materialIds: readonly string[];
  readonly title: string;
}

interface TopicFixture {
  readonly count: number;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly tone: CoverTone;
}

const materials = [
  {
    date: "Сегодня",
    duration: "12 мин",
    excerpt: "Разбираем границы сессии и доступа до первой строчки интеграции.",
    format: "guide",
    icon: ShieldCheck,
    id: "auth-without-dead-ends",
    label: "Сессия → доступ → профиль",
    new: true,
    tags: ["backend", "security"],
    title: "Авторизация без тупика",
    tone: "sand",
    topic: "Архитектура",
  },
  {
    date: "Вчера",
    duration: "18 мин",
    excerpt: "Как собрать воспроизводимый рабочий контур вокруг агента.",
    format: "guide",
    icon: Bot,
    id: "ai-first-loop",
    label: "Контекст → агент → проверка",
    tags: ["agents", "workflow"],
    title: "Мой AI-first контур",
    tone: "blue",
    topic: "AI-first",
  },
  {
    date: "1 сентября",
    duration: "9 мин",
    excerpt: "Почему глубокий модуль легче менять, тестировать и объяснять.",
    format: "guide",
    icon: Boxes,
    id: "deep-modules",
    label: "Интерфейс меньше реализации",
    new: true,
    access: "membership",
    tags: ["modules", "design"],
    title: "Глубокие модули на практике",
    tone: "lavender",
    topic: "Архитектура",
  },
  {
    date: "30 августа",
    duration: "14 мин",
    excerpt: "Поставка как понятный процесс, а не набор ритуальных проверок.",
    format: "video",
    icon: GitBranch,
    id: "delivery-without-rituals",
    label: "Изменение → evidence → решение",
    tags: ["ci-cd", "delivery"],
    title: "CI/CD без ритуалов",
    tone: "coral",
    topic: "Delivery",
  },
  {
    date: "28 августа",
    duration: "22 мин",
    excerpt: "Настоящий разбор сбоя: что увидели, где ошиблись и как восстановились.",
    format: "video",
    icon: Layers3,
    id: "incident-review",
    label: "Сигнал → гипотеза → восстановление",
    access: "membership",
    tags: ["production", "observability"],
    title: "Разбираем production-инцидент",
    tone: "ink",
    topic: "Инфраструктура",
  },
  {
    date: "27 августа",
    duration: "16 мин",
    excerpt: "Разделяем браузер, BFF и backend так, чтобы каждый слой отвечал только за своё.",
    format: "video",
    icon: ShieldCheck,
    id: "browser-bff-boundary",
    label: "Браузер → BFF → backend",
    new: true,
    tags: ["frontend", "security"],
    title: "Граница между браузером и backend",
    tone: "blue",
    topic: "Frontend",
  },
  {
    date: "26 августа",
    duration: "11 мин",
    excerpt: "Разбираем pull request по решениям, рискам и evidence, а не по количеству файлов.",
    format: "video",
    icon: FileCode2,
    id: "pull-request-review",
    label: "Решение → риск → evidence",
    tags: ["review", "delivery"],
    title: "Как я разбираю pull request",
    tone: "mint",
    topic: "Delivery",
  },
  {
    date: "26 августа",
    duration: "3 мин",
    excerpt: "Если агент не может назвать результат одной фразой, контекста либо мало, либо слишком много.",
    format: "note",
    icon: FileCode2,
    id: "agent-context",
    label: "Правила → задача → действие",
    tags: ["context", "agents"],
    title: "Контекст для агента без шума",
    tone: "mint",
    topic: "AI-first",
  },
  {
    date: "25 августа",
    duration: "2 мин",
    excerpt: "Показываю не только финальный код: оставил три гипотезы, проверку и причину, по которой две из них отбросил.",
    format: "note",
    icon: Sparkles,
    id: "show-the-decisions",
    label: "Гипотеза → проверка → решение",
    tags: ["process", "evidence"],
    title: "Почему показываю ход решения",
    tone: "blue",
    topic: "Delivery",
  },
  {
    date: "23 августа",
    duration: "4 мин",
    excerpt: "Короткая схема, которая помогает не смешивать данные, интерфейс и способ доставки.",
    format: "note",
    icon: Boxes,
    id: "three-boundaries",
    label: "Данные → интерфейс → доставка",
    tags: ["architecture", "frontend"],
    title: "Три границы перед началом работы",
    tone: "lavender",
    topic: "Архитектура",
  },
  {
    date: "22 августа",
    duration: "3 мин",
    excerpt: "Фильтр полезен только тогда, когда человек понимает, что исчезло из выдачи и как вернуть это обратно.",
    format: "note",
    icon: Search,
    id: "visible-filters",
    label: "Запрос → фильтр → результат",
    tags: ["search", "interface"],
    title: "Почему фильтры должны быть видимыми",
    tone: "sand",
    topic: "Frontend",
  },
  {
    date: "21 августа",
    duration: "2 мин",
    excerpt: "Один хороший сигнал о состоянии системы ценнее панели из двадцати графиков без следующего действия.",
    format: "note",
    icon: Layers3,
    id: "one-useful-signal",
    label: "Сигнал → решение → действие",
    tags: ["observability", "production"],
    title: "Один полезный сигнал",
    tone: "coral",
    topic: "Инфраструктура",
  },
  {
    date: "20 августа",
    duration: "3 мин",
    excerpt: "Плейлист становится маршрутом, когда порядок материалов отвечает на вопрос: что делать после этого шага.",
    format: "note",
    icon: List,
    id: "playlist-is-a-route",
    label: "Начало → порядок → результат",
    tags: ["learning", "structure"],
    title: "Плейлист — это маршрут",
    tone: "blue",
    topic: "AI-first",
  },
] as const satisfies readonly MaterialFixture[];

const playlists = [
  {
    count: 5,
    description: "От первой границы до работающего входа и профиля.",
    id: "membership-foundation",
    materialIds: ["auth-without-dead-ends", "deep-modules", "three-boundaries", "browser-bff-boundary", "visible-filters"],
    title: "Фундамент Membership",
  },
  {
    count: 7,
    description: "Практики для задач, которые выполняются вместе с агентом.",
    id: "ai-first-work",
    materialIds: ["ai-first-loop", "agent-context", "playlist-is-a-route", "show-the-decisions", "deep-modules", "pull-request-review", "visible-filters"],
    title: "AI-first работа",
  },
  {
    count: 4,
    description: "Доставка изменений с понятными сигналами и решениями.",
    id: "delivery-loop",
    materialIds: ["delivery-without-rituals", "incident-review", "pull-request-review", "show-the-decisions"],
    title: "Контур поставки",
  },
] as const satisfies readonly PlaylistFixture[];

const topics = [
  { count: 8, description: "Рабочие контуры, агенты и проверяемый результат.", icon: Bot, label: "AI-first", tone: "blue" },
  { count: 11, description: "Границы, интерфейсы и решения, которые легко менять.", icon: Boxes, label: "Архитектура", tone: "sand" },
  { count: 7, description: "Поставка изменений от первой проверки до production.", icon: GitBranch, label: "Delivery", tone: "coral" },
  { count: 5, description: "Интерфейсы, браузерные границы и удобные сценарии.", icon: Layers3, label: "Frontend", tone: "lavender" },
  { count: 4, description: "Наблюдаемость, инциденты и устойчивые системы.", icon: ShieldCheck, label: "Инфраструктура", tone: "mint" },
] as const satisfies readonly TopicFixture[];

const guides = materials.filter((material) => material.format === "guide");
const videos = materials.filter((material) => material.format === "video");
const notes = materials.filter((material) => material.format === "note");

export function MobileFirstPlatformPrototype({
  audience = "member",
  initialMaterialId = "auth-without-dead-ends",
  initialPlaylistId = "ai-first-work",
  initialScreen = "home",
  initialTopicLabel = "AI-first",
}: {
  readonly audience?: Audience;
  readonly initialMaterialId?: string;
  readonly initialPlaylistId?: string;
  readonly initialScreen?: PrototypeScreen;
  readonly initialTopicLabel?: string;
}) {
  const [screen, setScreen] = useState<PrototypeScreen>(initialScreen);
  const [history, setHistory] = useState<Exclude<PrototypeScreen, "material">[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialFixture>(findMaterial(initialMaterialId));
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistFixture>(findPlaylist(initialPlaylistId));
  const [selectedTopic, setSelectedTopic] = useState<TopicFixture>(findTopic(initialTopicLabel));
  const [libraryFormat, setLibraryFormat] = useState<MaterialFormat | "all">("all");

  function navigate(nextScreen: PrototypeScreen) {
    if (screen !== "material") setHistory((current) => [...current, screen]);
    setScreen(nextScreen);
  }

  function goBack(fallback: Exclude<PrototypeScreen, "material">) {
    const previousScreen = history[history.length - 1] ?? fallback;
    setHistory((current) => current.slice(0, -1));
    setScreen(previousScreen);
  }

  function selectRootScreen(nextScreen: NavigationScreen) {
    setHistory([]);
    setScreen(nextScreen);
  }

  function openMaterial(material: MaterialFixture) {
    setSelectedMaterial(material);
    navigate("material");
  }

  function openPlaylist(playlist: PlaylistFixture) {
    setSelectedPlaylist(playlist);
    navigate("playlist");
  }

  function openTopic(topic: TopicFixture) {
    setSelectedTopic(topic);
    navigate("topic");
  }

  function openLibrary(format: MaterialFormat | "all" = "all") {
    setLibraryFormat(format);
    navigate("library");
  }

  const previousScreen = history[history.length - 1];

  if (screen === "material") {
    return (
      <div data-prototype="mobile-first-platform">
        <MaterialReader
          locked={audience === "visitor" && selectedMaterial.access === "membership"}
          material={selectedMaterial}
          onBack={() => { goBack("home"); }}
          returnLabel={backDestinationLabel(previousScreen ?? "home")}
          selectScreen={selectRootScreen}
        />
      </div>
    );
  }

  const navigationScreen: NavigationScreen = screen === "topic" || screen === "playlist" ? "library" : screen;

  return (
    <div data-prototype="mobile-first-platform">
      <ApplicationShell screen={navigationScreen} selectScreen={selectRootScreen}>
        {screen === "home" ? (
          <MagazineHome audience={audience} openLibrary={openLibrary} openMaterial={openMaterial} openPlaylist={openPlaylist} openTopic={openTopic} />
        ) : screen === "library" ? (
          <LibraryScreen audience={audience} initialFormat={libraryFormat} openMaterial={openMaterial} openPlaylist={openPlaylist} openTopic={openTopic} />
        ) : screen === "topic" ? (
          <TopicScreen audience={audience} onBack={() => { goBack("library"); }} onOpenMaterial={openMaterial} onOpenPlaylist={openPlaylist} returnLabel={backDestinationLabel(previousScreen ?? "library")} topic={selectedTopic} />
        ) : screen === "playlist" ? (
          <PlaylistScreen audience={audience} onBack={() => { goBack("library"); }} onOpenMaterial={openMaterial} playlist={selectedPlaylist} returnLabel={backDestinationLabel(previousScreen ?? "library")} />
        ) : (
          <ProfileScreen openMaterial={openMaterial} />
        )}
      </ApplicationShell>
    </div>
  );
}

function ApplicationShell({
  children,
  screen,
  selectScreen,
}: {
  readonly children: ReactNode;
  readonly screen: NavigationScreen;
  readonly selectScreen: (screen: NavigationScreen) => void;
}) {
  return (
    <div className="flex min-h-svh items-start bg-white pb-28 text-[#202124] md:h-svh md:min-h-0 md:overflow-hidden md:pb-0">
      <DesktopNavigation screen={screen} selectScreen={selectScreen} />
      <main className="min-w-0 flex-1 bg-white md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-y-contain md:[scrollbar-gutter:stable]" data-desktop-scroll>{children}</main>
      <FloatingNavigation screen={screen} selectScreen={selectScreen} />
    </div>
  );
}

interface HomeProps {
  readonly audience: Audience;
  readonly openLibrary: (format?: MaterialFormat | "all") => void;
  readonly openMaterial: (material: MaterialFixture) => void;
  readonly openPlaylist: (playlist: PlaylistFixture) => void;
  readonly openTopic: (topic: TopicFixture) => void;
}

function MagazineHome({ audience, openLibrary, openMaterial, openPlaylist, openTopic }: HomeProps) {
  return (
    <div className="mx-auto max-w-[66rem] px-4 pb-16 pt-5 sm:px-7 md:px-10 md:pb-20 md:pt-9" data-page-frame>
      <ProductHeader />
      {audience === "member" ? <ContinueCard onOpen={() => { openMaterial(materials[1]); }} /> : null}
      <TopicRail onOpenAll={() => { openLibrary(); }} onOpenTopic={openTopic} />
      <SectionHeading action="Все видео" onAction={() => { openLibrary("video"); }} title="Новые видео" />
      <VideoGrid audience={audience} items={videos} onOpen={openMaterial} />
      <SectionHeading action="Все гайды" onAction={() => { openLibrary("guide"); }} title="Свежие гайды" />
      <GuideGrid audience={audience} items={guides} onOpen={openMaterial} />
      <SectionHeading action="Все плейлисты" onAction={() => { openLibrary(); }} title="Плейлисты" />
      <div className="mt-5 grid gap-4 md:grid-cols-2">{playlists.slice(0, 2).map((playlist) => <PlaylistCard audience={audience} key={playlist.id} onOpen={openPlaylist} playlist={playlist} />)}</div>
      <SectionHeading title="Заметки" />
      <ProgressiveNoteFeed onOpen={openMaterial} />
    </div>
  );
}

function ContinueCard({ onOpen }: { readonly onOpen: () => void }) {
  return <button className="mt-5 flex w-full items-center gap-3 rounded-[1.4rem] bg-[#f3f1ed] p-3 text-left md:max-w-xl" onClick={onOpen} type="button"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#c7461e] text-white"><Play aria-hidden="true" className="ml-0.5 size-4 fill-current" /></span><span className="min-w-0 flex-1"><span className="block text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-[#b83a1d]">Продолжить</span><strong className="mt-0.5 line-clamp-1 block text-sm">Мой AI-first контур</strong></span><span className="text-xs font-semibold text-[#5f5e59]">7 мин осталось</span></button>;
}

function LibraryScreen({ audience, initialFormat, openMaterial, openPlaylist, openTopic }: { readonly audience: Audience; readonly initialFormat: MaterialFormat | "all"; readonly openMaterial: (material: MaterialFixture) => void; readonly openPlaylist: (playlist: PlaylistFixture) => void; readonly openTopic: (topic: TopicFixture) => void }) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<MaterialFormat | "all">(initialFormat);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleMaterials = useMemo(() => {
    return materials.filter((material) => {
      const matchesFormat = format === "all" || material.format === format;
      const searchable = `${material.title} ${material.topic} ${material.excerpt} ${material.label} ${material.tags.join(" ")}`.toLocaleLowerCase("ru");
      return matchesFormat && (normalizedQuery.length === 0 || searchable.includes(normalizedQuery));
    });
  }, [format, normalizedQuery]);
  const visiblePlaylists = playlists.filter((playlist) => {
    const playlistMaterials = playlist.materialIds.map(findMaterial);
    const matchesFormat = format === "all" || playlistMaterials.some((material) => material.format === format);
    const searchable = [playlist.title, playlist.description, ...playlistMaterials.flatMap((material) => [material.title, material.topic, ...material.tags])].join(" ").toLocaleLowerCase("ru");
    return matchesFormat && (normalizedQuery.length === 0 || searchable.includes(normalizedQuery));
  });
  const visibleTopics = topics.filter((topic) => {
    const topicMaterials = materials.filter((material) => material.topic === topic.label);
    const matchesFormat = format === "all" || topicMaterials.some((material) => material.format === format);
    const searchable = [topic.label, ...topicMaterials.flatMap((material) => [material.title, ...material.tags])].join(" ").toLocaleLowerCase("ru");
    return matchesFormat && (normalizedQuery.length === 0 || searchable.includes(normalizedQuery));
  });
  const hasResults = visibleMaterials.length > 0 || visiblePlaylists.length > 0 || visibleTopics.length > 0;
  const resultCount = visibleMaterials.length + visiblePlaylists.length + visibleTopics.length;

  function resetAll() {
    setFormat("all");
    setQuery("");
  }

  return (
    <div className="mx-auto max-w-[66rem] px-4 pb-16 pt-5 sm:px-7 md:px-10 md:pb-20 md:pt-9" data-page-frame>
      <ProductHeader />
      <div className="mt-9 md:mt-12"><h1 className="text-[2.25rem] font-semibold leading-none tracking-[-0.055em] md:text-6xl">База знаний</h1></div>
      <div className="mt-7 flex min-h-14 items-center gap-3 rounded-2xl bg-[#f3f1ed] px-4">
        <Search aria-hidden="true" className="size-5 shrink-0 text-[#5f5e59]" /><label className="sr-only" htmlFor="library-search">Поиск по Базе знаний</label>
        <input className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#5f5e59]" id="library-search" onChange={(event) => { setQuery(event.target.value); }} placeholder="Материал, Плейлист, Тема или тег" type="search" value={query} />
        {query ? <button aria-label="Очистить поиск" className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-[#5f5e59]" onClick={() => { setQuery(""); }} type="button"><X aria-hidden="true" className="size-4" /></button> : null}
      </div>
      <div aria-label="Формат материала" className="mobile-lab-topic-rail -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group">
        {([["all", "Все форматы"], ["guide", "Гайды"], ["video", "Видео"], ["note", "Заметки"]] as const).map(([value, label]) => (
          <button aria-pressed={format === value} className={cn("min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold", format === value ? "bg-[#202124] text-white" : "bg-[#f3f1ed] text-[#5f5e59]")} key={value} onClick={() => { setFormat(value); }} type="button">{label}</button>
        ))}
      </div>
      <p aria-live="polite" className="mt-4 text-right text-xs font-semibold text-[#5f5e59]">Найдено: {resultCount}</p>

      {hasResults ? <>
        {visibleTopics.length > 0 ? <section aria-labelledby="library-topics-heading"><CatalogSectionHeading count={visibleTopics.length} id="library-topics-heading" title="Темы" /><div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-7 md:grid-cols-3 lg:grid-cols-4">{visibleTopics.map((topic) => <LibraryTopicCard key={topic.label} onOpen={() => { openTopic(topic); }} topic={topic} />)}</div></section> : null}
        {visiblePlaylists.length > 0 ? <section aria-labelledby="library-playlists-heading"><CatalogSectionHeading count={visiblePlaylists.length} id="library-playlists-heading" title="Плейлисты" /><div className="mt-4 grid gap-4 md:grid-cols-2">{visiblePlaylists.map((playlist) => <PlaylistCard audience={audience} key={playlist.id} onOpen={openPlaylist} playlist={playlist} />)}</div></section> : null}
        {visibleMaterials.length > 0 ? <section aria-labelledby="library-materials-heading"><CatalogSectionHeading count={visibleMaterials.length} id="library-materials-heading" title="Материалы" /><div className="mt-4 grid gap-3 md:grid-cols-2">{visibleMaterials.map((material) => <CompactMaterialCard key={material.id} locked={isMaterialLocked(audience, material)} material={material} onOpen={openMaterial} />)}</div></section> : null}
      </> : <div className="mt-12 rounded-[2rem] bg-[#f3f1ed] px-5 py-12 text-center"><Search aria-hidden="true" className="mx-auto size-7 text-[#8a8984]" /><h2 className="mt-4 text-xl font-semibold">Ничего не нашли</h2><p className="mt-2 text-sm text-[#5f5e59]">Измени запрос или выбранные фильтры.</p><button className="mt-5 min-h-11 rounded-full bg-[#202124] px-5 text-sm font-semibold text-white" onClick={resetAll} type="button">Сбросить всё</button></div>}
    </div>
  );
}

function TopicScreen({ audience, onBack, onOpenMaterial, onOpenPlaylist, returnLabel, topic }: { readonly audience: Audience; readonly onBack: () => void; readonly onOpenMaterial: (material: MaterialFixture) => void; readonly onOpenPlaylist: (playlist: PlaylistFixture) => void; readonly returnLabel: string; readonly topic: TopicFixture }) {
  const topicMaterials = materials.filter((material) => material.topic === topic.label);
  const topicPlaylists = playlists.filter((playlist) => playlist.materialIds.some((id) => findMaterial(id).topic === topic.label));
  const Icon = topic.icon;

  return <div className="mx-auto max-w-[66rem] px-4 pb-16 pt-5 sm:px-7 md:px-10 md:pb-20 md:pt-9" data-page-frame><ProductHeader /><CollectionBack label={returnLabel} onBack={onBack} /><section className={cn("mobile-lab-cover-grid mt-5 overflow-hidden rounded-[2rem] p-6 md:grid md:grid-cols-[1fr_auto] md:items-center md:p-10", coverToneClass(topic.tone))}><div><p className="text-xs font-bold uppercase tracking-[0.14em] opacity-70">Тема · {topicMaterials.length} материалов</p><h1 className="mt-3 text-[2.35rem] font-semibold leading-none tracking-[-0.055em] md:text-6xl">{topic.label}</h1><p className="mt-4 max-w-2xl text-base leading-7 opacity-70 md:text-lg">{topic.description}</p></div><span className="mt-7 grid size-24 rotate-[-5deg] place-items-center rounded-[1.6rem] border border-white/45 bg-white/75 shadow-xl backdrop-blur-sm md:mt-0 md:size-32"><Icon aria-hidden="true" className="size-12 md:size-16" strokeWidth={1.6} /></span></section>{topicPlaylists.length > 0 ? <section aria-labelledby="topic-playlists"><CatalogSectionHeading count={topicPlaylists.length} id="topic-playlists" title="Плейлисты" /><div className="mt-4 grid gap-4 md:grid-cols-2">{topicPlaylists.map((playlist) => <PlaylistCard audience={audience} key={playlist.id} onOpen={onOpenPlaylist} playlist={playlist} />)}</div></section> : null}<section aria-labelledby="topic-materials"><CatalogSectionHeading count={topicMaterials.length} id="topic-materials" title="Материалы" /><div className="mt-4 grid gap-3 md:grid-cols-2">{topicMaterials.map((material) => <CompactMaterialCard key={material.id} locked={isMaterialLocked(audience, material)} material={material} onOpen={onOpenMaterial} />)}</div></section></div>;
}

function PlaylistScreen({ audience, onBack, onOpenMaterial, playlist, returnLabel }: { readonly audience: Audience; readonly onBack: () => void; readonly onOpenMaterial: (material: MaterialFixture) => void; readonly playlist: PlaylistFixture; readonly returnLabel: string }) {
  const playlistMaterials = playlist.materialIds.map(findMaterial);

  return <div className="mx-auto max-w-[66rem] px-4 pb-16 pt-5 sm:px-7 md:px-10 md:pb-20 md:pt-9" data-page-frame><ProductHeader /><CollectionBack label={returnLabel} onBack={onBack} /><section className="mt-5 overflow-hidden rounded-[2rem] bg-[#202124] p-6 text-white md:p-10"><span className="inline-flex rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/75">Плейлист · {playlist.count} материалов</span><h1 className="mt-5 max-w-3xl text-[2.35rem] font-semibold leading-none tracking-[-0.055em] md:text-6xl">{playlist.title}</h1><p className="mt-4 max-w-2xl text-base leading-7 text-white/65 md:text-lg">{playlist.description}</p><div className="mt-7 grid max-w-xl grid-cols-3 gap-2">{playlistMaterials.slice(0, 3).map((material) => <AccessCover key={material.id} locked={isMaterialLocked(audience, material)}><CoverArt className="aspect-[4/3] min-h-0 rounded-2xl p-2" material={material} showNew={false} /></AccessCover>)}</div></section><section aria-labelledby="playlist-route"><CatalogSectionHeading count={playlistMaterials.length} id="playlist-route" title="Маршрут" /><ol className="mt-4 grid gap-3">{playlistMaterials.map((material, index) => <li className="grid grid-cols-[2rem_1fr] items-center gap-3" key={material.id}><span className="grid size-8 place-items-center rounded-full bg-[#f3f1ed] text-xs font-bold text-[#5f5e59]">{index + 1}</span><CompactMaterialCard locked={isMaterialLocked(audience, material)} material={material} onOpen={onOpenMaterial} /></li>)}</ol></section></div>;
}

function CollectionBack({ label, onBack }: { readonly label: string; readonly onBack: () => void }) {
  return <button aria-label={`Назад: ${label}`} className="mt-7 inline-flex min-h-10 items-center gap-2 rounded-full bg-[#f3f1ed] px-4 text-sm font-semibold" onClick={onBack} type="button"><ArrowLeft aria-hidden="true" className="size-4" />{label}</button>;
}

function CatalogSectionHeading({ count, id, title }: { readonly count: number; readonly id: string; readonly title: string }) {
  return <div className="mt-11 flex items-end justify-between gap-4"><h2 className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl" id={id}>{title}</h2><span className="text-sm font-semibold text-[#5f5e59]">{count}</span></div>;
}

function PlaylistCard({ audience = "member", onOpen, playlist }: { readonly audience?: Audience; readonly onOpen: (playlist: PlaylistFixture) => void; readonly playlist: PlaylistFixture }) {
  const playlistMaterials = playlist.materialIds.map(findMaterial);
  return <button aria-label={`Открыть плейлист ${playlist.title}`} className="group w-full min-w-0 overflow-hidden rounded-[2rem] bg-[#202124] p-5 text-left text-white" data-playlist-card onClick={() => { onOpen(playlist); }} type="button"><span className="flex items-start justify-between gap-3"><span className="inline-flex rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/75">Плейлист · {playlist.count} материалов</span><span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#202124]"><ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span></span><strong className="mt-4 block text-xl leading-6 tracking-[-0.035em] md:text-2xl md:leading-7">{playlist.title}</strong><span className="mt-2 block text-sm leading-5 text-white/65">{playlist.description}</span><span className="mt-6 grid grid-cols-3 gap-2">{playlistMaterials.slice(0, 3).map((material) => <AccessCover key={material.id} locked={isMaterialLocked(audience, material)}><CoverArt className="aspect-[4/3] min-h-0 rounded-2xl p-2" material={material} showNew={false} /></AccessCover>)}</span></button>;
}

function LibraryTopicCard({ onOpen, topic }: { readonly onOpen: () => void; readonly topic: (typeof topics)[number] }) {
  const Icon = topic.icon;
  return <button aria-label={`Открыть тему ${topic.label}`} className="group min-w-0 text-left" onClick={onOpen} type="button"><span className={cn("mobile-lab-cover-grid relative flex aspect-square min-h-0 overflow-hidden rounded-[1.5rem] p-4", coverToneClass(topic.tone))}><span className="absolute right-3 top-3 rounded-full bg-white/75 px-2.5 py-1 text-[0.625rem] font-bold text-[#202124] backdrop-blur-sm">{topic.count}</span><span className="m-auto grid size-20 rotate-[-5deg] place-items-center rounded-[1.4rem] border border-white/35 bg-white/78 text-[#202124] shadow-[0_1.5rem_3rem_-1.5rem_rgb(20_21_24/0.65)] backdrop-blur-sm transition-transform group-hover:-translate-y-1"><Icon aria-hidden="true" className="size-10" strokeWidth={1.7} /></span></span><strong className="mt-3 block text-[0.9375rem] leading-5 tracking-[-0.02em] md:text-lg md:leading-6">{topic.label}</strong><span className="mt-1 block text-xs font-medium text-[#5f5e59]">{topic.count} материалов</span></button>;
}

function ProfileScreen({ openMaterial }: { readonly openMaterial: (material: MaterialFixture) => void }) {
  return (
    <div className="mx-auto max-w-[48rem] px-4 pb-16 pt-5 sm:px-7 md:px-10 md:pb-20 md:pt-9">
      <ProductHeader />
      <section className="pt-10 md:pt-16">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b83a1d]">Личный центр</p>
        <div className="mt-5 rounded-[2rem] bg-[#f3f1ed] p-6 md:p-9">
          <Avatar /><h1 className="mt-6 text-4xl font-semibold tracking-[-0.05em]">Кирилл</h1><p className="mt-2 text-[#5f5e59]">Участник Inside · доступ активен</p>
          <div className="mt-8 grid grid-cols-2 gap-3"><ProfileFact label="Доступ" value="Активен" /><ProfileFact label="Прочитано" value="12" /></div>
          <button className="mt-6 min-h-12 w-full rounded-2xl bg-[#202124] px-5 font-semibold text-white" type="button">Настроить профиль</button>
        </div>
        <h2 className="mt-10 text-2xl font-semibold tracking-[-0.04em]">Недавно смотрели</h2>
        <div className="mt-4 grid gap-3">{materials.slice(0, 2).map((material) => <CompactMaterialCard key={material.id} material={material} onOpen={openMaterial} />)}</div>
      </section>
    </div>
  );
}

function MaterialReader({ locked, material, onBack, returnLabel, selectScreen }: { readonly locked: boolean; readonly material: MaterialFixture; readonly onBack: () => void; readonly returnLabel: string; readonly selectScreen: (screen: NavigationScreen) => void }) {
  const [read, setRead] = useState(false);

  return (
    <div className="flex min-h-svh items-start bg-white text-[#202124] md:h-svh md:min-h-0 md:overflow-hidden">
      <DesktopNavigation screen="library" selectScreen={selectScreen} />
      <div className="min-w-0 flex-1 md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-y-contain md:[scrollbar-gutter:stable]" data-desktop-scroll>
        <article className="mx-auto min-h-svh max-w-[68rem] bg-white" data-reader-frame>
          <ReaderHeader onBack={onBack} returnLabel={returnLabel} title={material.title} />
          <div className="mx-auto max-w-[60rem] px-5 pb-32 pt-5 sm:px-8 md:px-12 md:pb-20 md:pt-10">
            <div className="grid gap-6 md:grid-cols-[1fr_0.95fr] md:items-stretch">
              <div className="order-2 flex flex-col md:order-1 md:py-6">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#b83a1d]">{formatLabel(material.format)} · {material.topic}</p>
                <h1 className="mt-3 text-[2.3rem] font-semibold leading-[1.02] tracking-[-0.055em] md:text-[3.75rem]">{material.title}</h1>
                <p className="mt-5 text-lg leading-8 text-[#5f5e59]">{material.excerpt}</p>
                <div className="mt-6 flex flex-wrap items-center gap-2">{material.tags.map((item) => <span className="rounded-full bg-[#f3f1ed] px-3 py-1.5 text-xs font-semibold text-[#5f5e59]" key={item}>#{item}</span>)}</div>
                <div className="mt-7 flex items-center gap-3 text-sm font-semibold"><Avatar size="small" /> Кирилл Сачков</div>
                {!locked ? <div className="mt-6 hidden md:block"><ReadAction read={read} setRead={setRead} /></div> : null}
              </div>
              {material.format === "video" && !locked ? <VideoPlayer className="order-1 md:order-2" material={material} /> : material.format === "video" ? <VideoCover className="order-1 min-h-[15rem] md:order-2" material={material} /> : <CoverArt className="order-1 min-h-[15rem] md:order-2" material={material} showNew={false} />}
            </div>
            {locked ? <LockedBodyPreview /> : <ReaderContent material={material} />}
            {!locked ? <div className="mx-auto mt-14 hidden max-w-[43rem] border-t border-black/8 pt-8 md:block"><ReadAction read={read} setRead={setRead} /></div> : null}
          </div>
        </article>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/6 bg-white/92 p-3 backdrop-blur-xl md:hidden">{locked ? <AccessAction /> : <ReadAction read={read} setRead={setRead} />}</div>
    </div>
  );
}

function ReaderContent({ material }: { readonly material: MaterialFixture }) {
  return <div className="mx-auto mt-10 max-w-[43rem] md:mt-16"><details className="group rounded-[1.25rem] bg-[#f3f1ed] p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold"><span className="inline-flex items-center gap-2"><List aria-hidden="true" className="size-4 text-[#b83a1d]" />Содержание · 2</span><ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" /></summary><nav aria-label="Содержание материала" className="mt-4 grid gap-2 border-t border-black/8 pt-4 text-sm text-[#5f5e59]"><a href="#reader-boundaries">1. Сначала разделяем понятия</a><a href="#reader-project">2. Что переносим в проект</a></nav></details><p className="mt-8 text-xl font-semibold leading-8 tracking-[-0.02em]">Хорошее решение начинается не с библиотеки и не с таблицы в базе. Оно начинается с точной границы ответственности.</p><h2 className="mt-12 scroll-mt-24 text-3xl font-semibold tracking-[-0.04em]" id="reader-boundaries">Сначала разделяем понятия</h2><ReaderParagraphs /><InlineDiagram /><h2 className="mt-12 scroll-mt-24 text-3xl font-semibold tracking-[-0.04em]" id="reader-project">Что переносим в проект</h2><ReaderParagraphs compact />{material.format === "video" ? <p className="mt-8 rounded-[1.25rem] border-l-4 border-[#c7461e] bg-[#f3f1ed] p-5 text-base leading-7 text-[#5f5e59]">Ключевая схема из видео остаётся рядом с конспектом, чтобы к ней можно было вернуться без перемотки.</p> : null}</div>;
}

function LockedBodyPreview() {
  return <section aria-label="Закрытая часть материала" className="relative mx-auto mt-12 max-w-[43rem] overflow-hidden rounded-[2rem] border border-black/6 bg-[#f3f1ed] p-6 md:p-9"><div aria-hidden="true" className="select-none space-y-5 blur-[7px] opacity-45"><div className="h-7 w-2/3 rounded-full bg-[#777873]" /><div className="space-y-3"><div className="h-4 rounded-full bg-[#8b8c88]" /><div className="h-4 w-11/12 rounded-full bg-[#8b8c88]" /><div className="h-4 w-4/5 rounded-full bg-[#8b8c88]" /></div><div className="h-36 rounded-[1.5rem] bg-white" /><div className="space-y-3"><div className="h-4 rounded-full bg-[#8b8c88]" /><div className="h-4 w-3/4 rounded-full bg-[#8b8c88]" /></div></div><div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-white/20 via-white/70 to-white/95 px-6 text-center"><span className="grid size-12 place-items-center rounded-full bg-white shadow-lg"><LockKeyhole aria-hidden="true" className="size-5 text-[#c7461e]" /></span><h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">Продолжение для участников</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[#5f5e59]">Открой полный материал и весь маршрут по теме.</p><div className="mt-5 hidden md:block"><AccessAction /></div></div></section>;
}

function ReadAction({ read, setRead }: { readonly read: boolean; readonly setRead: (read: boolean) => void }) {
  return <button aria-pressed={read} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[1.25rem] bg-[#202124] px-5 text-sm font-semibold text-white md:w-auto md:min-w-64" onClick={() => { setRead(!read); }} type="button"><CheckCircle2 aria-hidden="true" className={cn("size-5", read ? "text-[#69c77a]" : "text-[#ef6b3c]")} />{read ? "Прочитано" : "Отметить прочитанным"}</button>;
}

function AccessAction() {
  return <button className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[1.25rem] bg-[#c7461e] px-6 text-sm font-semibold text-white md:w-auto md:min-w-64" type="button"><LockKeyhole aria-hidden="true" className="size-5" />Получить доступ</button>;
}

function VideoPlayer({ className, material }: { readonly className?: string; readonly material: MaterialFixture }) {
  const Icon = material.icon;
  return <button aria-label={`Воспроизвести видео «${material.title}»`} className={cn("group relative aspect-video min-h-[15rem] overflow-hidden rounded-[1.75rem] bg-[#202124] text-white", className)} type="button"><span className="absolute inset-0 bg-[radial-gradient(circle_at_75%_18%,rgb(199_70_30/0.58),transparent_34%),linear-gradient(145deg,rgb(255_255_255/0.06),transparent_55%)]" /><Icon aria-hidden="true" className="absolute right-[10%] top-[12%] size-[46%] opacity-20" strokeWidth={1.1} /><span className="absolute inset-0 grid place-items-center"><span className="grid size-16 place-items-center rounded-full bg-white text-[#202124] shadow-2xl transition-transform group-hover:scale-105"><Play aria-hidden="true" className="ml-1 size-6 fill-current" /></span></span><span className="absolute inset-x-5 bottom-5"><span className="flex items-center justify-between text-xs font-semibold"><span>00:00</span><span>{material.duration}</span></span><span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/25"><span className="block h-full w-[8%] rounded-full bg-[#ef6b3c]" /></span></span></button>;
}

function ProductHeader() {
  return <header className="md:hidden"><p className="text-lg font-extrabold tracking-[-0.035em]">Sachkov <span className="text-[#c7461e]">Inside</span></p></header>;
}

function TopicRail({ onOpenAll, onOpenTopic }: { readonly onOpenAll: () => void; readonly onOpenTopic: (topic: TopicFixture) => void }) {
  return <nav aria-label="Темы" className="mobile-lab-topic-rail -mx-4 mt-7 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"><button className="min-h-10 shrink-0 rounded-full bg-[#202124] px-4 text-sm font-semibold text-white" onClick={onOpenAll} type="button">Все темы</button>{topics.map((topic) => <button className="min-h-10 shrink-0 rounded-full bg-[#f3f1ed] px-4 text-sm font-semibold text-[#5f5e59]" key={topic.label} onClick={() => { onOpenTopic(topic); }} type="button">{topic.label}</button>)}</nav>;
}

function SectionHeading({ action, onAction, title }: { readonly action?: string; readonly onAction?: () => void; readonly title: string }) {
  return <div className="mt-11 flex items-end justify-between gap-4"><h2 className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl">{title}</h2>{action ? <button className="shrink-0 text-sm font-semibold text-[#b83a1d]" onClick={onAction} type="button">{action}</button> : null}</div>;
}

function GuideGrid({ audience, items, onOpen }: { readonly audience: Audience; readonly items: readonly MaterialFixture[]; readonly onOpen: (material: MaterialFixture) => void }) {
  return <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-7 md:grid-cols-3 md:gap-x-5 md:gap-y-9">{items.map((material) => <GuideCard key={material.id} locked={isMaterialLocked(audience, material)} material={material} onOpen={onOpen} />)}</div>;
}

function GuideCard({ locked = false, material, onOpen }: { readonly locked?: boolean; readonly material: MaterialFixture; readonly onOpen: (material: MaterialFixture) => void }) {
  return <button className="group min-w-0 text-left" onClick={() => { onOpen(material); }} type="button"><AccessCover locked={locked}><CoverArt className="aspect-square min-h-0 transition-transform group-hover:-translate-y-1" material={material} /></AccessCover><span className="mt-3 block text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-[#66655f]">{material.topic}</span><strong className="mt-1 line-clamp-2 block text-[0.9375rem] leading-5 tracking-[-0.02em] md:text-lg md:leading-6">{material.title}</strong><span className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#5f5e59]"><Clock3 aria-hidden="true" className="size-3.5" /> {material.duration}</span></button>;
}

function VideoGrid({ audience, items, onOpen }: { readonly audience: Audience; readonly items: readonly MaterialFixture[]; readonly onOpen: (material: MaterialFixture) => void }) {
  return <div className="mt-5 grid grid-cols-2 items-start gap-x-3 gap-y-7 md:grid-cols-3 md:gap-x-5" data-video-grid>{items.map((material) => <button className="min-w-0 text-left" key={material.id} onClick={() => { onOpen(material); }} type="button"><AccessCover locked={isMaterialLocked(audience, material)}><VideoCover className="aspect-video min-h-0 rounded-[1.25rem]" material={material} /></AccessCover><strong className="mt-3 line-clamp-2 block text-[0.9375rem] leading-5 tracking-[-0.025em] md:text-lg md:leading-6">{material.title}</strong><span className="mt-1 block text-xs font-medium text-[#5f5e59] md:text-sm">{material.topic}</span></button>)}</div>;
}


function NoteFeed({ items, onOpen }: { readonly items: readonly MaterialFixture[]; readonly onOpen: (material: MaterialFixture) => void }) {
  return <div className="mt-5 grid gap-3">{items.map((material) => <NotePost key={material.id} material={material} onOpen={onOpen} />)}</div>;
}

function ProgressiveNoteFeed({ onOpen }: { readonly onOpen: (material: MaterialFixture) => void }) {
  const [visibleCount, setVisibleCount] = useState(2);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || visibleCount >= notes.length || typeof IntersectionObserver === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      timer = setTimeout(() => { setVisibleCount((current) => Math.min(current + 2, notes.length)); }, 250);
    }, { rootMargin: "0px 0px 120px" });
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [visibleCount]);

  return <><NoteFeed items={notes.slice(0, visibleCount)} onOpen={onOpen} />{visibleCount < notes.length ? <button className="mt-4 min-h-12 w-full rounded-2xl bg-[#f3f1ed] px-5 text-sm font-semibold" onClick={() => { setVisibleCount((current) => Math.min(current + 2, notes.length)); }} ref={loadMoreRef} type="button">Показать ещё</button> : null}</>;
}

function NotePost({ children, material, onOpen }: { readonly children?: ReactNode; readonly material: MaterialFixture; readonly onOpen: (material: MaterialFixture) => void }) {
  return <article className="rounded-[1.75rem] border border-black/6 bg-white p-5 shadow-[0_1.2rem_3rem_-2.3rem_rgb(20_22_26/0.35)] md:p-7"><div className="flex items-center gap-3"><Avatar size="small" /><p className="text-sm"><strong>Кирилл</strong><span className="text-[#5f5e59]"> · {material.topic} · {material.date}</span></p></div><h3 className="mt-4 text-xl font-semibold leading-6 tracking-[-0.03em]">{material.title}</h3><p className="mt-2 text-[1.0625rem] leading-7 tracking-[-0.015em] text-[#4d4e51] md:text-xl md:leading-8">{material.excerpt}</p>{children}<button className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#b83a1d]" onClick={() => { onOpen(material); }} type="button">Читать заметку <ChevronRight aria-hidden="true" className="size-4" /></button></article>;
}


function CompactMaterialCard({ locked = false, material, onOpen }: { readonly locked?: boolean; readonly material: MaterialFixture; readonly onOpen: (material: MaterialFixture) => void }) {
  return <button className="grid min-w-0 grid-cols-[5.5rem_1fr_auto] items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-[0_1rem_2.5rem_-2rem_rgb(20_21_24/0.35)]" onClick={() => { onOpen(material); }} type="button"><AccessCover compact locked={locked}>{material.format === "video" ? <VideoCover className="aspect-square min-h-0 rounded-xl p-2" compact material={material} /> : <CoverArt className="aspect-square min-h-0 rounded-xl p-2" material={material} showNew={false} />}</AccessCover><span className="min-w-0"><span className="text-xs font-semibold text-[#5f5e59]">{formatLabel(material.format)} · {material.topic} · #{material.tags[0]}</span><strong className="mt-1 line-clamp-2 block text-base leading-5">{material.title}</strong></span><ChevronRight aria-hidden="true" className="size-4 text-[#5f5e59]" /></button>;
}

function AccessCover({ children, compact = false, locked }: { readonly children: ReactNode; readonly compact?: boolean; readonly locked: boolean }) {
  return <span className={cn("relative block overflow-hidden", compact ? "rounded-xl" : "rounded-[1.5rem]")} data-access-cover={locked ? "locked" : "open"}><span className={cn("block", locked && "scale-[1.04] blur-[4px]")}>{children}</span>{locked ? <span className="absolute inset-0 grid place-items-center bg-white/20"><span className={cn("inline-flex items-center gap-1.5 rounded-full bg-white/92 font-semibold text-[#202124] shadow-xl backdrop-blur-xl", compact ? "size-8 justify-center p-0" : "px-3 py-2 text-xs")}><LockKeyhole aria-hidden="true" className="size-4 text-[#c7461e]" />{compact ? <span className="sr-only">Для участников</span> : "Для участников"}</span></span> : null}</span>;
}

function CoverArt({ className, material, showNew = true }: { readonly className?: string; readonly material: MaterialFixture; readonly showNew?: boolean }) {
  const Icon = material.icon;
  return <span aria-label={`Обложка: ${material.label}`} className={cn("mobile-lab-cover-grid relative flex min-h-[13rem] overflow-hidden rounded-[1.5rem] p-4", coverToneClass(material.tone), className)} role="img">{material.new && showNew ? <span className="absolute right-3 top-3 rounded-full bg-[#202124] px-2.5 py-1 text-[0.625rem] font-bold text-white">Новое</span> : null}<span className="m-auto grid size-20 rotate-[-5deg] place-items-center rounded-[1.4rem] border border-white/35 bg-white/78 text-[#202124] shadow-[0_1.5rem_3rem_-1.5rem_rgb(20_21_24/0.65)] backdrop-blur-sm"><Icon aria-hidden="true" className="size-10" strokeWidth={1.7} /></span></span>;
}

function VideoCover({ className, compact = false, material }: { readonly className?: string; readonly compact?: boolean; readonly material: MaterialFixture }) {
  const Icon = material.icon;
  return <span aria-label={`Превью видео: ${material.title}`} className={cn("mobile-lab-video-cover relative flex min-h-[13rem] overflow-hidden rounded-[1.5rem] p-4", coverToneClass(material.tone), className)} data-video-cover role="img"><span className="absolute inset-0 bg-[radial-gradient(circle_at_72%_25%,rgb(255_255_255/0.45),transparent_32%)]" /><Icon aria-hidden="true" className="absolute right-[12%] top-[18%] size-[42%] opacity-25" strokeWidth={1.2} /><span className={cn("absolute rounded-full bg-black/70 font-semibold text-white", compact ? "bottom-1.5 right-1.5 px-2 py-1 text-[0.625rem] leading-none" : "bottom-3 right-3 px-2.5 py-1 text-[0.6875rem]")}>{material.duration}</span></span>;
}

function InlineDiagram() {
  return <figure className="mt-4 rounded-[1.5rem] bg-[#f3f1ed] p-4"><div className="grid grid-cols-3 gap-2 rounded-2xl border-2 border-dashed border-[#2864c7]/70 p-3">{["контекст", "задача", "evidence"].map((step) => <span className="grid min-h-12 place-items-center rounded-xl bg-white px-2 text-center text-xs font-semibold shadow-sm" key={step}><span><span className="mr-1 inline-block size-2 rounded-full bg-[#2864c7]" />{step}</span></span>)}</div><figcaption className="mt-3 text-sm font-semibold text-[#347548]">Результат можно проверить без догадок.</figcaption></figure>;
}

function ReaderHeader({ onBack, returnLabel, title }: { readonly onBack: () => void; readonly returnLabel: string; readonly title: string }) {
  return <header className="sticky top-0 z-30 border-b border-black/6 bg-white/88 px-4 py-3 backdrop-blur-xl md:px-7"><div className="mx-auto grid max-w-[82rem] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"><button aria-label={`Назад: ${returnLabel}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-black/5 px-3 text-xs font-semibold" onClick={onBack} type="button"><ArrowLeft aria-hidden="true" className="size-4" />{returnLabel}</button><p className="truncate text-center text-sm font-bold tracking-[-0.025em]">{title}</p><span aria-hidden="true" className="w-20" /></div></header>;
}

function ReaderParagraphs({ compact = false }: { readonly compact?: boolean }) {
  return <div className="mt-5 grid gap-5 text-[1.0625rem] leading-8 text-[#696a6e]"><p>Если смешать сессию, Membership и профиль в одно понятие, любое изменение provider начинает менять весь продукт. Поэтому сначала называем каждую ответственность отдельно.</p>{compact ? null : <p>После этого появляется простая проверка: материал открывается только по локальному решению о доступе, а чтение не зависит от внешнего сервиса.</p>}</div>;
}

function FloatingNavigation({ screen, selectScreen }: { readonly screen: NavigationScreen; readonly selectScreen: (screen: NavigationScreen) => void }) {
  const items = [{ icon: Home, label: "Главная", screen: "home" }, { icon: LibraryBig, label: "База", screen: "library" }, { icon: UserRound, label: "Профиль", screen: "profile" }] as const;
  return <nav aria-label="Навигация прототипа" className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-[1.6rem] border border-black/8 bg-white/88 p-1.5 text-[#202124] shadow-[0_1.5rem_4rem_-1.25rem_rgb(20_21_24/0.6)] backdrop-blur-xl md:hidden">{items.map((item) => { const current = screen === item.screen; const Icon = item.icon; return <button aria-current={current ? "page" : undefined} aria-label={item.label} className={cn("flex min-h-12 items-center justify-center gap-2 rounded-[1.15rem] px-3 text-xs font-semibold transition-[background,color,padding]", current ? "bg-[#202124] px-5 text-white" : "text-[#5f5e59]")} key={item.screen} onClick={() => { selectScreen(item.screen); }} type="button"><Icon aria-hidden="true" className="size-5" />{current ? <span>{item.label}</span> : null}</button>; })}</nav>;
}

function DesktopNavigation({ screen, selectScreen }: { readonly screen: NavigationScreen; readonly selectScreen: (screen: NavigationScreen) => void }) {
  return <Sidebar><SidebarBody><DesktopNavigationContents screen={screen} selectScreen={selectScreen} /></SidebarBody></Sidebar>;
}

function DesktopNavigationContents({ screen, selectScreen }: { readonly screen: NavigationScreen; readonly selectScreen: (screen: NavigationScreen) => void }) {
  const { open } = useSidebar();

  return <div className="flex h-full min-h-0 w-full flex-1 flex-col p-3"><div className="flex min-h-0 flex-1 flex-col gap-6"><div className={cn("flex min-h-11 items-center gap-2", open ? "justify-between px-2" : "justify-center")}><DesktopBrand onClick={() => { selectScreen("home"); }} />{open ? <SidebarToggle /> : null}</div><nav aria-label="Основная" className="flex flex-col gap-1"><DesktopNavButton current={screen === "home"} icon={Home} label="Главная" onClick={() => { selectScreen("home"); }} /><DesktopNavButton current={screen === "library"} icon={LibraryBig} label="База знаний" onClick={() => { selectScreen("library"); }} /></nav></div><div className="shrink-0 border-t border-sidebar-border pt-3"><DesktopNavButton current={screen === "profile"} icon={CircleUserRound} label="Профиль" onClick={() => { selectScreen("profile"); }} /></div></div>;
}

function DesktopBrand({ onClick }: { readonly onClick: () => void }) {
  const { open } = useSidebar();

  return <button aria-label="Sachkov Inside" className={cn("shrink-0 text-sidebar-foreground", open ? "min-w-0 truncate rounded-md text-sm font-semibold tracking-[-0.025em]" : "grid size-8 place-items-center rounded-lg bg-sidebar-foreground text-xs font-extrabold text-sidebar")} onClick={onClick} type="button">{open ? "Sachkov Inside" : "S"}</button>;
}

function DesktopNavButton({ current, icon: Icon, label, onClick }: { readonly current: boolean; readonly icon: LucideIcon; readonly label: string; readonly onClick: () => void }) {
  const { open } = useSidebar();

  return <button aria-current={current ? "page" : undefined} aria-label={open ? undefined : label} className={cn("group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground/72 transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-sidebar-ring motion-reduce:transition-none", current && "bg-sidebar-accent text-sidebar-accent-foreground")} onClick={(event) => { onClick(); if (event.detail > 0) event.currentTarget.blur(); }} type="button"><span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center transition-colors", current && "text-sidebar-primary")}><Icon className="size-5" /></span><span aria-hidden={!open} className={cn("hidden whitespace-nowrap transition-[opacity,transform] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none md:inline", open ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0")}>{label}</span>{current ? <span aria-hidden="true" className="ml-auto hidden size-1.5 rounded-full bg-sidebar-primary md:block" /> : null}</button>;
}

function Avatar({ showAccess = false, size = "default" }: { readonly showAccess?: boolean; readonly size?: "default" | "small" }) {
  return <span aria-label={showAccess ? "Профиль Кирилла, доступ активен" : "Профиль Кирилла"} className={cn("relative grid shrink-0 place-items-center rounded-full bg-[#202124] font-bold text-white ring-4 ring-[#f3f1ed]", size === "small" ? "size-9 text-xs" : "size-12 text-sm")} role="img">К{showAccess ? <span aria-hidden="true" className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-white bg-[#c7461e]"><Check className="size-3" strokeWidth={3} /></span> : null}</span>;
}

function ProfileFact({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="rounded-2xl bg-white p-4"><strong className="text-2xl">{value}</strong><span className="mt-1 block text-xs font-semibold text-[#5f5e59]">{label}</span></div>;
}

function coverToneClass(tone: CoverTone): string {
  switch (tone) {
    case "blue": return "bg-[#dce9ff] text-[#205aa7]";
    case "coral": return "bg-[#ffdcd2] text-[#b83a25]";
    case "ink": return "bg-[#25272d] text-white";
    case "lavender": return "bg-[#e9e1ff] text-[#5d43a4]";
    case "mint": return "bg-[#dcefe5] text-[#267057]";
    case "sand": return "bg-[#eee8dc] text-[#86663e]";
  }
}

function formatLabel(format: MaterialFormat): string {
  switch (format) {
    case "guide": return "Гайд";
    case "note": return "Заметка";
    case "video": return "Видео";
  }
}

function findMaterial(id: string): MaterialFixture {
  return materials.find((material) => material.id === id) ?? materials[0];
}

function findPlaylist(id: string): PlaylistFixture {
  return playlists.find((playlist) => playlist.id === id) ?? playlists[0];
}

function findTopic(label: string): TopicFixture {
  return topics.find((topic) => topic.label === label) ?? topics[0];
}

function isMaterialLocked(audience: Audience, material: MaterialFixture): boolean {
  return audience === "visitor" && material.access === "membership";
}

function backDestinationLabel(screen: Exclude<PrototypeScreen, "material">): string {
  switch (screen) {
    case "home": return "На главную";
    case "library": return "В Базу";
    case "playlist": return "К плейлисту";
    case "profile": return "В профиль";
    case "topic": return "К теме";
  }
}
