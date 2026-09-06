"use client";

// Throwaway Storybook study for #311: three navigation layouts around the real HomePage.
import {
  ArrowLeft,
  ArrowRight,
  Home,
  LibraryBig,
  LogIn,
  Map,
  Menu,
  Route,
  Search,
  Settings2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import type { MaterialPreview } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import type { HomeView } from "../model/home-view";
import { HomePage } from "./home-page";
import { illustratedHome } from "./illustrated-home.fixture";
import "./navigation.prototype.css";

const variants = ["header", "compact", "sidebar"] as const;
type Variant = (typeof variants)[number];
const labels = {
  header: "A · Верхняя шапка",
  compact: "B · Короткая панель",
  sidebar: "C · Полный сайдбар",
};
const sections = [
  { label: "Главная", icon: Home },
  { label: "База знаний", icon: LibraryBig },
  { label: "Карты", icon: Map },
  { label: "Роадмапы", icon: Route },
  { label: "Мастерская", icon: Wrench },
] as const;

// Use the existing fixture and production fallback covers; no API or image server required.
const withoutCover = (material: MaterialPreview): MaterialPreview => ({
  ...material,
  cover: null,
});
const home: HomeView = {
  ...illustratedHome,
  videos: illustratedHome.videos.map(withoutCover),
  guides: illustratedHome.guides.slice(0, 3).map(withoutCover),
  topics: illustratedHome.topics
    .slice(0, 1)
    .map((topic) => ({ ...topic, cover: null })),
  playlists: illustratedHome.playlists.map((series) => ({
    ...series,
    cover: null,
    previewItems: series.previewItems.map(withoutCover),
  })),
};

export interface NavigationPrototypeProps {
  readonly brandContent?: ReactNode;
  readonly showNavigationControls?: boolean;
  readonly initialVariant?: Variant;
  readonly initialExpanded?: boolean;
}

export function NavigationPrototype({
  brandContent,
  showNavigationControls = true,
  initialVariant = "header",
  initialExpanded = false,
}: NavigationPrototypeProps) {
  const [variant, setVariant] = useState<Variant>(() => {
    if (!showNavigationControls) return initialVariant;
    const saved = new URL(window.location.href).searchParams.get("variant");
    return saved === "header" || saved === "compact" || saved === "sidebar"
      ? saved
      : initialVariant;
  });
  const [expanded, setExpanded] = useState(initialExpanded);
  const [anchors, setAnchors] = useState(false);
  const [member, setMember] = useState(false);
  const [settings, setSettings] = useState(false);
  const [active, setActive] = useState("Главная");
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const visibleSections = expanded ? sections : sections.slice(0, 2);

  function switchVariant(step: number) {
    const next =
      variants[
        (variants.indexOf(variant) + step + variants.length) % variants.length
      ] ?? "header";
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!showNavigationControls) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, button, a, [contenteditable], [role=dialog]",
        )
      )
        return;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        notice !== null ||
        menu
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        switchVariant(event.key === "ArrowLeft" ? -1 : 1);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
    };
  });

  function navigate(label: string) {
    setActive(label);
    setQuery("");
    setMenu(false);
  }

  function interceptPreviewLink(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a");
    if (link === null || link.getAttribute("href")?.startsWith("#")) return;
    event.preventDefault();
    setNotice(
      link.getAttribute("aria-label") ?? link.textContent?.trim() ?? "Материал",
    );
  }

  const brand = (
    <button
      className="np-brand"
      onClick={() => {
        navigate("Главная");
      }}
      aria-label="Sachkov Inside — на главную"
    >
      {brandContent ?? (
        <>
          <span className="np-monogram">S</span>
          <span className="np-wordmark">Sachkov Inside</span>
        </>
      )}
    </button>
  );
  const account = (
    <Button
      className="np-account rounded-full"
      onClick={() => {
        setNotice(member ? "Аккаунт" : "Войти");
      }}
    >
      <span>{member ? "Кирилл" : "Войти"}</span>
      {member ? <UserRound aria-hidden="true" /> : <LogIn aria-hidden="true" />}
    </Button>
  );
  const navigation = (place: string) => (
    <nav aria-label={`Основная · ${place}`} className="np-nav">
      {visibleSections.map(({ label, icon: Icon }) => (
        <button
          key={label}
          aria-current={active === label ? "page" : undefined}
          onClick={() => {
            navigate(label);
          }}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <div
      data-public-shell
      data-navigation-prototype
      data-variant={variant}
      data-anchors={anchors}
    >
      <a href="#navigation-content" className="np-skip">
        Перейти к содержанию
      </a>
      {variant !== "header" && (
        <aside className="np-sidebar" aria-label="Боковая панель">
          {brand}
          {variant === "sidebar" && (
            <div className="np-sidebar-account">{account}</div>
          )}
          {navigation("боковая панель")}
        </aside>
      )}
      <div className="np-page">
        <header className="np-header">
          <div className="np-header-inner">
            <div className="np-header-brand">{brand}</div>
            {variant === "header" && (
              <div className="np-header-navigation">{navigation("шапка")}</div>
            )}
            <button
              className="np-search"
              aria-label="Найти материал"
              onClick={() => {
                navigate("База знаний");
              }}
            >
              <Search aria-hidden="true" />
              <span>Найти материал</span>
            </button>
            <div className="np-header-account">{account}</div>
            <Dialog.Root open={menu} onOpenChange={setMenu}>
              <Dialog.Trigger className="np-menu" aria-label="Открыть меню">
                <Menu aria-hidden="true" />
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="np-overlay" />
                <Dialog.Content
                  className="np-dialog np-menu-dialog"
                  aria-describedby={undefined}
                >
                  <Dialog.Title className="text-xl font-bold">
                    Разделы
                  </Dialog.Title>
                  {navigation("меню")}
                  <Dialog.Close className="np-close" aria-label="Закрыть меню">
                    <X aria-hidden="true" />
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </header>
        <main id="navigation-content" tabIndex={-1} className="np-content">
          {active === "Главная" ? (
            <div className="np-home" onClick={interceptPreviewLink}>
              <HomePage
                result={{
                  kind: "ready",
                  value: member
                    ? { ...home, membership: { kind: "active" } }
                    : home,
                }}
              />
            </div>
          ) : active === "База знаний" ? (
            <section>
              <h1 className="text-3xl font-bold tracking-tight">База знаний</h1>
              <label className="np-catalog-search">
                <Search aria-hidden="true" />
                <input
                  autoFocus
                  aria-label="Поиск по материалам"
                  placeholder="Найти материал"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
              </label>
              <div className="mt-8 grid gap-3">
                {[...home.videos, ...home.guides]
                  .filter((item) =>
                    item.title
                      .toLocaleLowerCase("ru")
                      .includes(query.toLocaleLowerCase("ru")),
                  )
                  .map((item) => (
                    <button
                      className="np-result"
                      key={item.slug}
                      onClick={() => {
                        setNotice(item.title);
                      }}
                    >
                      <span className="text-sm text-muted-foreground">
                        {item.format}
                      </span>
                      <strong>{item.title}</strong>
                      <ArrowRight aria-hidden="true" />
                    </button>
                  ))}
              </div>
              <p className="mt-8 text-sm text-muted-foreground">
                Поиск по демонстрационным материалам для сравнения навигации.
              </p>
            </section>
          ) : (
            <section className="np-future">
              <p className="text-sm text-action">Будущий раздел</p>
              <h1 className="mt-3 text-4xl font-bold">{active}</h1>
              <p className="mt-5 max-w-lg text-muted-foreground">
                Здесь проверяем положение раздела в меню. Его содержимое
                предстоит спроектировать отдельно.
              </p>
              <Button
                className="mt-8"
                variant="outline"
                onClick={() => {
                  navigate("Главная");
                }}
              >
                Вернуться на главную
              </Button>
            </section>
          )}
        </main>
      </div>
      {variant === "compact" && (
        <div className="np-bottom">{navigation("нижняя панель")}</div>
      )}
      {showNavigationControls && (
        <aside className="np-controls" aria-label="Сравнение вариантов">
          {settings && (
            <div className="np-settings">
              <strong>Условия сравнения</strong>
              <label>
                <input
                  type="checkbox"
                  checked={expanded}
                  onChange={(event) => {
                    setExpanded(event.target.checked);
                    navigate("Главная");
                  }}
                />
                Будущие разделы · всего 5
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={anchors}
                  onChange={(event) => {
                    setAnchors(event.target.checked);
                  }}
                />
                Якоря главной страницы
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={member}
                  onChange={(event) => {
                    setMember(event.target.checked);
                  }}
                />
                Пользователь вошёл
              </label>
              <p>
                Прототип #311. Выбрана верхняя шапка. Логотип прорабатывается
                отдельно.
              </p>
            </div>
          )}
          <div className="np-switcher">
            <button
              aria-label="Предыдущий вариант"
              onClick={() => {
                switchVariant(-1);
              }}
            >
              <ArrowLeft aria-hidden="true" />
            </button>
            <span aria-live="polite">
              <strong>{labels[variant]}</strong>
              <small>
                {expanded ? "5 разделов" : "2 раздела"} ·{" "}
                {member ? "участник" : "гость"} · якоря{" "}
                {anchors ? "вкл." : "выкл."}
              </small>
            </span>
            <button
              aria-label="Следующий вариант"
              onClick={() => {
                switchVariant(1);
              }}
            >
              <ArrowRight aria-hidden="true" />
            </button>
            <button
              aria-label="Условия сравнения"
              aria-expanded={settings}
              onClick={() => {
                setSettings(!settings);
              }}
            >
              <Settings2 aria-hidden="true" />
            </button>
          </div>
        </aside>
      )}
      <Dialog.Root
        open={notice !== null}
        onOpenChange={(open) => {
          if (!open) setNotice(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="np-overlay" />
          <Dialog.Content className="np-dialog">
            <Dialog.Title className="text-xl font-bold pr-8">
              {notice}
            </Dialog.Title>
            <Dialog.Description className="mt-4 text-sm leading-6 text-muted-foreground">
              Это просмотр навигации. Настоящий вход, подписка и страницы
              материалов здесь не открываются. Состояние после входа можно
              включить в «Условиях сравнения» внизу.
            </Dialog.Description>
            <Dialog.Close className="np-close" aria-label="Закрыть">
              <X aria-hidden="true" />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
