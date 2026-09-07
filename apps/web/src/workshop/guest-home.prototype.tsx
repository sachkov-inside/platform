"use client";

import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Code2, MessageCircle, Users } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import Link from "next/link";


import { MaterialCard, type MaterialPreview } from "@/entities/material";
import { PlaylistCard } from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { ApplicationShell } from "@/widgets/application-shell";
import "./guest-home.prototype.css";

/** Throwaway #380: three guest Home compositions using the current Platform shell and cards.
 * Storybook-only sample content and in-memory navigation; no access or payment changes.
 * Compare via named stories or ?variant=A|B|C. Owner verdict is pending.
 */
export type GuestVariant = "A" | "B" | "C";
const avatarUrl = new URL("./guest-home-assets/kirill-explaining.png", import.meta.url).href;
const variants = { A: "Сначала материалы", B: "Серия с аватаром", C: "От автора" };
const materials = [
  { slug: "ci-checks", title: "Что проверять в CI до деплоя", summary: "Собираем короткий набор проверок, который ловит ошибки до production.", topic: "Инфраструктура", topicSlug: "delivery", format: "Гайд", formatSlug: "guide", access: "free", availability: "available", cover: null, tags: [], seriesMemberships: [] },
  { slug: "agent-context", title: "Как дать ИИ контекст своего проекта", summary: "Правила, границы задачи и проверка результата на примере рабочего репозитория.", topic: "Разработка с ИИ", topicSlug: "ai", format: "Гайд", formatSlug: "guide", access: "membership", availability: "locked", cover: null, tags: [], seriesMemberships: [] },
  { slug: "module-boundaries", title: "Границы модулей: где провести линию", summary: "Разбираем ответственность, интерфейс и стоимость следующего изменения.", topic: "Архитектура", topicSlug: "architecture", format: "Гайд", formatSlug: "guide", access: "membership", availability: "locked", cover: null, tags: [], seriesMemberships: [] },
  { slug: "safe-deploy", title: "Деплой с возможностью отката", summary: "Версия приложения, проверка готовности и возврат к рабочему состоянию.", topic: "Инфраструктура", topicSlug: "delivery", format: "Гайд", formatSlug: "guide", access: "membership", availability: "locked", cover: null, tags: [], seriesMemberships: [] },
] as const satisfies readonly MaterialPreview[];
const firstMaterial = materials[0];
const series = [
  { slug: "code-to-production", name: "От кода до production", summary: "Собери понятный путь от изменения в коде до безопасного деплоя.", countLabel: "3 материала", cover: null, previewItems: [firstMaterial, materials[3], materials[2]] },
  { slug: "inside-with-ai", name: "Создаём Inside с ИИ", summary: "Проследи, как я проектирую и развиваю реальную платформу вместе с агентами.", countLabel: "3 материала", cover: null, previewItems: [materials[1], materials[2], materials[3]] },
] as const;
const benefits = [
  { icon: BookOpen, title: "Цельные практические гайды", text: "Задача, объяснение, код и проверка результата — в одном материале." },
  { icon: Code2, title: "Современная инженерия", text: "Разработка с ИИ, архитектура и инженерная база на реальных задачах." },
  { icon: MessageCircle, title: "Обсуждение со мной", text: "Задавай вопросы по материалам и обсуждай со мной свои решения." },
  { icon: Users, title: "Сообщество разработчиков", text: "Сравнивай подходы, делись опытом и разбирайся вместе с участниками." },
];
type Screen = { kind: "home" } | { kind: "series"; slug: string } | { kind: "material"; slug: string } | { kind: "membership" } | { kind: "library" };

export function GuestHomePrototype({ initialVariant = "A" }: { readonly initialVariant?: GuestVariant }) {
  const [variant, setVariant] = useState<GuestVariant>(() => {
    const param = new URLSearchParams(window.location.search).get("variant");
    return param === "A" || param === "B" || param === "C" ? param : initialVariant;
  });
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const root = useRef<HTMLDivElement>(null);
  const choose = (next: GuestVariant) => {
    setVariant(next);
    setScreen({ kind: "home" });
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
    root.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [screen, variant]);
  const subscribe = () =>{  setScreen({ kind: "membership" }); };
  function intercept(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a");
    if (link === null) return;
    const url = new URL(link.href);
    if (url.hash === "#content") return;
    event.preventDefault();
    if (url.pathname.startsWith("/materials/")) setScreen({ kind: "material", slug: url.pathname.split("/")[2] ?? "" });
    else if (url.pathname.startsWith("/series/")) setScreen({ kind: "series", slug: url.pathname.split("/")[2] ?? "" });
    else if (url.pathname === "/library") setScreen({ kind: "library" });
    else if (url.pathname === "/account") subscribe();
    else setScreen({ kind: "home" });
  }
  return (
    <div ref={root} onClickCapture={intercept} data-guest-variant={variant} data-guest-screen={screen.kind}>
      <nav className="gh-switcher" aria-label="Варианты прототипа">
        <button aria-label="Предыдущий вариант" onClick={() =>{  cycle(-1); }}><ChevronLeft aria-hidden="true" /></button>
        <span aria-live="polite"><small>ПРОТОТИП</small>{variant} · {variants[variant]}</span>
        <button aria-label="Следующий вариант" onClick={() =>{  cycle(1); }}><ChevronRight aria-hidden="true" /></button>
      </nav>
      <ApplicationShell currentPath="/" navigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }]} mobileNavigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }, { href: "/account", icon: "profile", label: "Доступ" }]} accountSlot={<CTA onClick={subscribe} />}>
        <div className="guest-home">
          {screen.kind !== "home" && <Button className="mb-6 min-h-11" variant="ghost" onClick={() =>{  setScreen({ kind: "home" }); }}><ArrowLeft aria-hidden="true" /> На главную</Button>}
          {screen.kind === "home" && <>
            {variant === "A" && <VariantA subscribe={subscribe} />}
            {variant === "B" && <VariantB subscribe={subscribe} />}
            {variant === "C" && <VariantC subscribe={subscribe} />}
          </>}
          {screen.kind === "library" && <><Title>База знаний</Title><p className="gh-lead">Выбери интересную задачу и начни с открытого материала.</p><Guides /></>}
          {screen.kind === "series" && <SeriesScreen slug={screen.slug} subscribe={subscribe} />}
          {screen.kind === "material" && <MaterialScreen slug={screen.slug} subscribe={subscribe} />}
          {screen.kind === "membership" && <><p className="gh-eyebrow">Подписка Sachkov Inside</p><Title>Вся инженерная кухня — внутри</Title><p className="gh-lead">Полные гайды и серии, код и другие материалы, обсуждение с автором и сообществом.</p><h2 className="sr-only">Что входит в подписку</h2><Benefits /><div className="gh-demo-note" role="status">Это пример экрана подписки. Стоимость и оформление появятся после выбора условий. В прототипе оплаты нет.</div><Button className="mt-6 min-h-11" variant="outline" onClick={() =>{  setScreen({ kind: "library" }); }}>Вернуться к материалам</Button></>}
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
function Guides() { return <div className="gh-guides">{materials.map((material) => <div key={material.slug}><MaterialCard material={material} headingLevel="h3" returnHref="/" />{material.access === "free" && <span className="gh-free">Можно прочитать целиком</span>}</div>)}</div>; }
function SeriesCards() { return <div className="gh-series-cards">{series.map((playlist) => <PlaylistCard key={playlist.slug} playlist={playlist} returnHref="/" />)}</div>; }
function Invitation({ subscribe }: { readonly subscribe: () => void }) { return <section className="gh-invitation"><div><p className="gh-eyebrow">Полный доступ к Inside</p><h2>Изучай. Применяй. Обсуждай.</h2><p>Все материалы и серии, вопросы автору и сообщество разработчиков — в одной подписке.</p></div><CTA onClick={subscribe} /></section>; }

export function VariantA({ subscribe }: { readonly subscribe: () => void }) {
  return <><header className="gh-intro"><p className="gh-eyebrow">Sachkov Inside · для тех, кто уже пишет код</p><Title>Разбирайся глубже.<br />Применяй в своей разработке.</Title><p className="gh-lead">Цельные практические гайды, инженерная база и разработка с ИИ. С объяснением решений и обсуждением со мной и сообществом.</p><Actions subscribe={subscribe} /></header><section><Heading aside="Начни с интересной задачи">Попробуй Inside</Heading><Guides /></section><section><Heading>Разбираем по шагам</Heading><SeriesCards /></section><section><Heading>Больше, чем доступ к текстам</Heading><Benefits /></section><Invitation subscribe={subscribe} /></>;
}
export function VariantB({ subscribe }: { readonly subscribe: () => void }) {
  const [topic, setTopic] = useState("Все");
  const filtered = topic === "Все" ? materials : materials.filter((material) => material.topic === topic);
  return <>
    <header className="gh-banner-intro"><div><p className="gh-eyebrow">Практика современной разработки</p><Title>Загляни внутрь Inside</Title></div><span>С Кириллом Сачковым</span></header>
    <section className="gh-featured" aria-labelledby="featured-title">
      <div className="gh-featured-copy"><p className="gh-featured-label">С чего начать · Серия</p><h2 id="featured-title">Создаём реальный<br />продукт с ИИ</h2><p>От идеи и архитектуры до кода и деплоя.<br />На примере самой платформы Inside.</p><div className="gh-featured-bottom"><span>Гайды · Код · Решения</span><Link href="/series/inside-with-ai">Изучить серию <ArrowRight aria-hidden="true" /></Link></div></div>
      <div className="gh-presenter" aria-hidden="true"><span className="gh-floating-code">&lt;/&gt;</span>{/* Vite serves the copied prototype asset; no Next image optimizer in Storybook. */}
      {/* oxlint-disable-next-line next/no-img-element */}
      <img src={avatarUrl} alt="" width="1024" height="1536" /><span className="gh-floating-note"><Check /> Проверяем на практике</span></div>
    </section>
    <div className="gh-topic-filters" aria-label="Темы материалов">{["Все", "Разработка с ИИ", "Архитектура", "Инфраструктура"].map((name) => <button key={name} aria-pressed={topic === name} onClick={() => { setTopic(name); }}>{name}</button>)}</div>
    <section className="gh-access-strip"><BookOpen aria-hidden="true" /><div><strong>Гайды, серии и общение с автором</strong><p>Изучай открытые материалы. Подписка откроет Inside целиком.</p></div><CTA onClick={subscribe} label="Полный доступ" /></section>
    <section><Heading aside="Выбери интересную задачу">{topic === "Все" ? "Гайды и разборы" : topic}</Heading><div className="gh-guides">{filtered.map((material) => <div key={material.slug}><MaterialCard material={material} headingLevel="h3" returnHref="/" />{material.access === "free" && <span className="gh-free">Можно прочитать целиком</span>}</div>)}</div></section>
    <section><Heading>Серии для погружения</Heading><SeriesCards /></section>
    <section><Heading>Что даёт подписка</Heading><Benefits /></section><Invitation subscribe={subscribe} />
  </>;
}
export function VariantC({ subscribe }: { readonly subscribe: () => void }) {
  return <><header className="gh-author-intro"><div><p className="gh-eyebrow">Кирилл Сачков · Sachkov Inside</p><Title>Показываю, как я<br />делаю продукты.</Title><p className="gh-lead">Как выбираю архитектуру, работаю с ИИ и довожу код до production. Объясняю решения в практических гайдах — чтобы ты мог применить их в своей работе.</p><Actions subscribe={subscribe} /></div><aside className="gh-author-note"><Code2 aria-hidden="true" /><p>«Мне важно показать весь ход мысли: что за задача, почему такое решение и как проверить, что оно работает».</p><span>Кирилл Сачков<br /><small>Автор Inside</small></span></aside></header><section className="gh-editorial"><div><Heading>Внутри реального продукта</Heading><p className="gh-lead">Отдельные решения складываются в целую историю разработки.</p><PlaylistCard playlist={series[1]} returnHref="/" /></div><aside className="gh-discussion"><MessageCircle aria-hidden="true" /><h2>После чтения<br />разговор продолжается</h2><p>Задавай вопросы по материалу, приноси свои решения и обсуждай их со мной и другими разработчиками.</p><div className="gh-discussion-example"><span>Пример темы для обсуждения</span><p>«Где бы вы провели границу этого модуля в своём проекте?»</p></div><span className="gh-eyebrow">Сообщество входит в подписку</span></aside></section><section><Heading>Посмотри, как я объясняю</Heading><Guides /></section><h2 className="sr-only">Что входит в подписку</h2><Benefits /><Invitation subscribe={subscribe} /></>;
}
function SeriesScreen({ slug, subscribe }: { readonly slug: string; readonly subscribe: () => void }) {
  const item = series.find((value) => value.slug === slug) ?? series[0];
  return <><p className="gh-eyebrow">Серия · {item.countLabel}</p><Title>{item.name}</Title><p className="gh-lead">{item.summary}</p><div className="gh-series-list">{item.previewItems.map((material, index) => <Link key={material.slug} href={`/materials/${material.slug}`}><span>0{index + 1}</span><div><h2>{material.title}</h2><p>{material.summary}</p><small>{material.access === "free" ? "Открытый гайд" : "Начало открыто · полностью по подписке"}</small></div><ArrowRight aria-hidden="true" /></Link>)}</div><Invitation subscribe={subscribe} /></>;
}
function MaterialScreen({ slug, subscribe }: { readonly slug: string; readonly subscribe: () => void }) {
  const material = materials.find((value) => value.slug === slug) ?? firstMaterial;
  const open = material.access === "free";
  return <article className="gh-reader"><p className="gh-eyebrow">{material.topic} · Гайд · {open ? "Открытый материал" : "Открытое начало"}</p><Title>{material.title}</Title><p className="gh-lead">{material.summary}</p><div className="gh-reading-body"><h2>Начнём с задачи</h2><p>{open ? "Изменение может собираться на твоём компьютере и ломаться у другого разработчика. До деплоя нужно убедиться, что проект можно собрать с нуля, а изменённое поведение работает так, как задумано." : `${material.summary} Начни с конкретного изменения: что должно стать возможным для пользователя и по каким признакам ты поймёшь, что задача решена.`}</p><h2>{open ? "Три проверки до деплоя" : "Сначала зафиксируй границы"}</h2><p>{open ? "Установка по lock-файлу проверяет воспроизводимость зависимостей. Сборка и проверка типов обнаруживают несовместимые интерфейсы. Тест изменённого сценария проверяет поведение, которое ты обещаешь пользователю." : "Запиши входные данные, ожидаемый результат и то, что менять не нужно. Найди существующий сценарий и опиши, какое поведение должно сохраниться. Так у решения появится проверяемая граница."}</p>{open && <><div className="gh-code">Изменение → сборка → проверка поведения → деплой</div><h2>Попробуй на своём проекте</h2><p>Возьми последнее изменение. Определи, какая проверка заметила бы его поломку. Если такой проверки нет, добавь её в CI и убедись, что она падает на сломанном варианте.</p><p>Зелёный CI подтверждает только то, что ты проверил. Готовность приложения после деплоя проверяется отдельно.</p><p className="gh-free"><Check aria-hidden="true" /> Ты прочитал открытый пример целиком</p></>}</div><section className="gh-reader-offer"><BookOpen aria-hidden="true" /><h2>{open ? "Хочешь разобрать весь путь до production?" : "Продолжить чтение с подпиской Inside"}</h2><p>{open ? "В Inside отдельные задачи складываются в серии. Продолжай изучение и обсуждай свои решения с автором и сообществом." : "Полный разбор, примеры кода и проверка результата. А ещё — все остальные гайды, серии и обсуждение с автором."}</p><CTA onClick={subscribe} /><span>Полные материалы · Автор · Сообщество</span></section></article>;
}
