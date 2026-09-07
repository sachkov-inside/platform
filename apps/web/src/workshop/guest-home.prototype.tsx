"use client";

import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Code2, GitBranch, Terminal, MessageCircle, Users } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import Link from "next/link";


import { MaterialCard } from "@/entities/material";
import { PlaylistCard } from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { ApplicationShell } from "@/widgets/application-shell";
import { materials, series } from "./guest-home.fixture";
import { ProductionGuestScene } from "./guest-home-production-scenes";
import "./guest-home.prototype.css";

/** Throwaway #380: three guest Home compositions using the current Platform shell and cards.
 * Storybook-only sample content and in-memory navigation; no access or payment changes.
 * Compare via named stories or ?variant=A|B|C. Owner verdict is pending.
 */
export type GuestVariant = "A" | "B" | "C";
const avatarUrl = new URL("./guest-home-assets/kirill-explaining.png", import.meta.url).href;
const variants = { A: "Сначала материалы", B: "Серия с аватаром", C: "От автора" };
const benefits = [
  { icon: BookOpen, title: "Цельные практические гайды", text: "Задача, объяснение, код и проверка результата — в одном материале." },
  { icon: Code2, title: "Современная инженерия", text: "Разработка с ИИ, архитектура и инженерная база на реальных задачах." },
  { icon: MessageCircle, title: "Обсуждение со мной", text: "Задавай вопросы по материалам и обсуждай со мной свои решения." },
  { icon: Users, title: "Сообщество разработчиков", text: "Сравнивай подходы, делись опытом и разбирайся вместе с участниками." },
];


export function GuestHomePrototype({ initialVariant = "A" }: { readonly initialVariant?: GuestVariant }) {
  const [variant, setVariant] = useState<GuestVariant>(() => {
    const param = new URLSearchParams(window.location.search).get("variant");
    return param === "A" || param === "B" || param === "C" ? param : initialVariant;
  });
  const [href, setHref] = useState("/");
  const [demoNotice, setDemoNotice] = useState(false);
  const route = new URL(href, window.location.origin);
  const isHome = route.pathname === "/";
  const root = useRef<HTMLDivElement>(null);
  const choose = (next: GuestVariant) => {
    setVariant(next);
    setHref("/");
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
  };
  const cycle = (offset: number) => { choose((["A", "B", "C"] as const)[(["A", "B", "C"].indexOf(variant) + offset + 3) % 3] ?? "A"); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, a, [contenteditable], [role=dialog]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cycle(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () =>{  window.removeEventListener("keydown", onKey); };
  });
  useEffect(() => {
    root.current?.querySelector("main")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    const heading = root.current?.querySelector<HTMLElement>("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [href, variant]);
  const subscribe = () => { setHref("/account"); };
  function intercept(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a");
    if (link === null) return;
    const url = new URL(link.href);
    // Reader outline/skip links scroll inside the current production presentation.
    if (url.hash && url.pathname === window.location.pathname) return;
    if (!["/", "/library", "/account"].includes(url.pathname) && !/^\/(materials|series|topics)\//u.test(url.pathname)) return;
    event.preventDefault();
    setDemoNotice(false);
    setHref(`${url.pathname}${url.search}`);
  }
  return (
    <div ref={root} onClickCapture={intercept} data-guest-variant={variant} data-guest-screen={isHome ? "home" : route.pathname.split("/")[1]}>
      <nav className="gh-switcher" aria-label="Варианты прототипа">
        <button aria-label="Предыдущий вариант" onClick={() =>{  cycle(-1); }}><ChevronLeft aria-hidden="true" /></button>
        <span aria-live="polite"><small>ПРОТОТИП</small>{variant} · {variants[variant]}</span>
        <button aria-label="Следующий вариант" onClick={() =>{  cycle(1); }}><ChevronRight aria-hidden="true" /></button>
      </nav>
      <ApplicationShell currentPath={route.pathname} navigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }]} mobileNavigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }, { href: "/account", icon: "profile", label: "Профиль" }]} accountSlot={<CTA onClick={subscribe} />}>
        <div className="guest-home">
          {isHome ? <>
            {variant === "A" && <VariantA subscribe={subscribe} />}
            {variant === "B" && <VariantB subscribe={subscribe} />}
            {variant === "C" && <VariantC subscribe={subscribe} />}
          </> : <div onSubmit={(event) => { event.preventDefault(); setDemoNotice(true); }}>
            <ProductionGuestScene href={href} />
            {demoNotice && <p role="status" className="gh-demo-note">Вход доступен в приложении. Здесь показан его экран для проверки дизайна.</p>}
          </div>}
          <footer className="gh-footer">Sachkov Inside · Кирилл Сачков <span>Инженерная практика, которой можно пользоваться.</span></footer>
        </div>
      </ApplicationShell>

    </div>
  );
}
function Title({ children }: { readonly children: ReactNode }) { return <h1 tabIndex={-1} className="gh-title">{children}</h1>; }
function CTA({ onClick, label = "Получить полный доступ" }: { readonly onClick: () => void; readonly label?: string }) { return <Button className="gh-cta" onClick={onClick}>{label}<ArrowRight aria-hidden="true" /></Button>; }
function Actions({ subscribe }: { readonly subscribe: () => void }) { return <div className="gh-actions"><CTA onClick={subscribe} /><Link href="/materials/ci-checks" className="gh-text-link">Прочитать открытый гайд <ArrowRight aria-hidden="true" /></Link></div>; }
function Benefits() { return <div className="gh-benefits">{benefits.map(({ icon: Icon, title, text }) => <div key={title}><Icon aria-hidden="true" /><h3>{title}</h3><p>{text}</p></div>)}</div>; }
function Heading({ children, aside }: { readonly children: ReactNode; readonly aside?: string }) { return <div className="gh-heading"><h2>{children}</h2>{aside && <span>{aside}</span>}</div>; }
function Guides() { return <div className="gh-guides">{materials.map((material) => <div key={material.slug}><MaterialCard material={material} headingLevel="h3" returnHref="/" /></div>)}</div>; }
function SeriesCards() { return <div className="gh-series-cards">{series.map((playlist) => <PlaylistCard key={playlist.slug} playlist={playlist} returnHref="/" />)}</div>; }
function Invitation({ subscribe }: { readonly subscribe: () => void }) { return <section className="gh-invitation"><div><p className="gh-eyebrow">Полный доступ к Inside</p><h2>Изучай. Применяй. Обсуждай.</h2><p>Все материалы и серии, вопросы автору и сообщество разработчиков — в одной подписке.</p></div><CTA onClick={subscribe} /></section>; }

export function VariantA({ subscribe }: { readonly subscribe: () => void }) {
  return <><header className="gh-intro"><p className="gh-eyebrow">Sachkov Inside · для тех, кто уже пишет код</p><Title>Разбирайся глубже.<br />Применяй в своей разработке.</Title><p className="gh-lead">Цельные практические гайды, инженерная база и разработка с ИИ. С объяснением решений и обсуждением со мной и сообществом.</p><Actions subscribe={subscribe} /></header><section><Heading aside="Начни с интересной задачи">Попробуй Inside</Heading><Guides /></section><section><Heading>Разбираем по шагам</Heading><SeriesCards /></section><section><Heading>Больше, чем доступ к текстам</Heading><Benefits /></section><Invitation subscribe={subscribe} /></>;
}
export function VariantB({ subscribe }: { readonly subscribe: () => void }) {
  const [topic, setTopic] = useState("Все");
  const filtered = topic === "Все" ? materials : materials.filter((material) => material.topic === topic);
  return <>
    <h1 className="sr-only">Главная Inside</h1>
    <section className="gh-featured" aria-labelledby="featured-title">
      <div className="gh-featured-copy"><p className="gh-featured-label">С чего начать · Серия</p><h2 id="featured-title">Создаём реальный<br />продукт с ИИ</h2><p className="gh-featured-description">От идеи и архитектуры до кода и деплоя.<br />На примере самой платформы Inside.</p><div className="gh-featured-bottom"><span>Гайды · Код · Решения</span><Link href="/series/inside-with-ai?from=%2F">Изучить серию <ArrowRight aria-hidden="true" /></Link></div></div>
      <div className="gh-presenter" aria-hidden="true">
        <div className="gh-presenter-crop">
          {/* Vite serves the copied prototype asset; no Next image optimizer in Storybook. */}
          {/* oxlint-disable-next-line next/no-img-element */}
          <img src={avatarUrl} alt="" width="1024" height="1536" />
        </div>
        <span className="gh-floating-note"><Check /> Проверяем на практике</span>
        <span className="gh-particle gh-particle-code"><Code2 /></span>
        <span className="gh-particle gh-particle-branch"><GitBranch /></span>
        <span className="gh-particle gh-particle-terminal"><Terminal /></span>
      </div>
    </section>
    <div className="gh-topic-filters" aria-label="Темы материалов">{["Все", "Разработка с ИИ", "Архитектура", "Инфраструктура"].map((name) => <button key={name} aria-pressed={topic === name} onClick={() => { setTopic(name); }}>{name}</button>)}</div>
    <section className="gh-access-strip"><BookOpen aria-hidden="true" /><div><strong>Гайды, серии и общение с автором</strong><p>Изучай открытые материалы. Подписка откроет Inside целиком.</p></div><CTA onClick={subscribe} label="Полный доступ" /></section>
    <section><Heading aside="Выбери интересную задачу">{topic === "Все" ? "Гайды и разборы" : topic}</Heading><div className="gh-guides">{filtered.map((material) => <div key={material.slug}><MaterialCard material={material} headingLevel="h3" returnHref="/" /></div>)}</div></section>
    <section><Heading>Серии для погружения</Heading><SeriesCards /></section>
    <section><Heading>Что даёт подписка</Heading><Benefits /></section><Invitation subscribe={subscribe} />
  </>;
}
export function VariantC({ subscribe }: { readonly subscribe: () => void }) {
  return <><header className="gh-author-intro"><div><p className="gh-eyebrow">Кирилл Сачков · Sachkov Inside</p><Title>Показываю, как я<br />делаю продукты.</Title><p className="gh-lead">Как выбираю архитектуру, работаю с ИИ и довожу код до production. Объясняю решения в практических гайдах — чтобы ты мог применить их в своей работе.</p><Actions subscribe={subscribe} /></div><aside className="gh-author-note"><Code2 aria-hidden="true" /><p>«Мне важно показать весь ход мысли: что за задача, почему такое решение и как проверить, что оно работает».</p><span>Кирилл Сачков<br /><small>Автор Inside</small></span></aside></header><section className="gh-editorial"><div><Heading>Внутри реального продукта</Heading><p className="gh-lead">Отдельные решения складываются в целую историю разработки.</p><PlaylistCard playlist={series[1]} returnHref="/" /></div><aside className="gh-discussion"><MessageCircle aria-hidden="true" /><h2>После чтения<br />разговор продолжается</h2><p>Задавай вопросы по материалу, приноси свои решения и обсуждай их со мной и другими разработчиками.</p><div className="gh-discussion-example"><span>Пример темы для обсуждения</span><p>«Где бы вы провели границу этого модуля в своём проекте?»</p></div><span className="gh-eyebrow">Сообщество входит в подписку</span></aside></section><section><Heading>Посмотри, как я объясняю</Heading><Guides /></section><h2 className="sr-only">Что входит в подписку</h2><Benefits /><Invitation subscribe={subscribe} /></>;
}
