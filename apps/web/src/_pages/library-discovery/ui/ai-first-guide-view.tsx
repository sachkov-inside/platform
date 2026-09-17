import { ArrowLeft, ArrowRight, Check, Clock3, Code2, FileCode2, FolderGit2, GitPullRequest, MessagesSquare, Play, Server, Workflow, type LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type { GuidePage, GuidePageBlock, GuidePageBlockOf } from "@/entities/guide-page";
import { AiFirstProcessArtwork } from "@/features/ai-first-guide";
import { fillOneTimeTerms as fillTerms } from "@/features/billing-checkout";
import { formatMaterialCount, type PublishedSeriesResult } from "@/features/library-discovery";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";

import "./ai-first-guide-view.css";

/**
 * Оформление `ai-first-process`: весь текст приходит из описания продукта, а оформление добавляет
 * к известным блокам свои иллюстрации и значки. Блок с другим `id` рисуется по своему виду.
 * Сроки доступа и помощи подставляет оферта, поэтому в тексте автор пишет только подстановку.
 */
export function AiFirstGuideView({ result, page, returnTarget, freeEntryHref }: {
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly page: GuidePage;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly freeEntryHref?: Route;
}) {
  const freeCount = result.kind === "ready" ? result.items.filter(item => item.access === "free" && item.availability === "available").length : 0;
  const context: BlockContext = { fill: fillTerms, programme: guideProgrammeHref(result.reference.slug), freeEntryHref, freeCount, name: result.reference.name };
  return <article className="ai-guide-page" data-guide-product={result.reference.slug} data-guide-presentation="ai-first-process">
    <nav aria-label="Хлебные крошки"><Link className="ai-guide-back" href={returnTarget.href}><ArrowLeft />{returnTarget.label}</Link></nav>
    {/* Название продукта — заголовок страницы: его показывает hero, а без hero он всё равно нужен. */}
    {page.blocks.some(block => block.kind === "hero") ? null : <header className="ai-guide-hero"><div className="ai-guide-hero-copy"><h1>{result.reference.name}</h1></div></header>}
    {page.blocks.map(block => <AiFirstBlock block={block} context={context} key={block.id} />)}
    <div className="ai-guide-sticky"><Link className="ai-guide-button" href={context.programme}>Открыть программу<ArrowRight /></Link></div>
  </article>;
}

interface BlockContext {
  readonly fill: (text: string) => string;
  readonly programme: Route;
  readonly freeEntryHref: Route | undefined;
  readonly freeCount: number;
  readonly name: string;
}

function AiFirstBlock({ block, context }: { readonly block: GuidePageBlock; readonly context: BlockContext }): ReactNode {
  switch (block.kind) {
    case "hero": return <Hero block={block} context={context} />;
    case "cards":
      if (block.id === "outcomes") return <OutcomeCards block={block} fill={context.fill} />;
      if (block.id === "support") return <SupportCards block={block} fill={context.fill} />;
      if (block.id === "bonuses") return <BonusCards block={block} fill={context.fill} />;
      return <PlainCards block={block} fill={context.fill} />;
    case "text": return <TextSection block={block} fill={context.fill} />;
    case "steps": return <StepsSection block={block} context={context} />;
    case "list": return <ListSection block={block} fill={context.fill} />;
    case "trial": return context.freeEntryHref === undefined ? null : <section className="ai-guide-trial"><h2>{context.fill(block.title)}</h2><p>{context.fill(block.text)}</p>{block.link === "" ? null : <Link className="ai-guide-text-link" href={context.programme}>{context.fill(block.link)}<ArrowRight /></Link>}</section>;
  }
}

/**
 * Значки и иллюстрации оформление раздаёт по порядку пунктов блока: порядок в описании продукта
 * задаёт и порядок картинок, а лишний пункт получает общий значок без иллюстрации.
 */
function iconAt(icons: readonly LucideIcon[], index: number): LucideIcon {
  return icons[index] ?? Check;
}

const highlightIcons = [Code2, Clock3, MessagesSquare] as const;
function Hero({ block, context }: { readonly block: GuidePageBlockOf<"hero">; readonly context: BlockContext }) {
  return <header className="ai-guide-hero">
    <div className="ai-guide-hero-copy">
      <h1>{context.name}</h1>
      <p className="ai-guide-intro">{context.fill(block.lead)}</p>
      {block.highlights.length === 0 ? null : <ul className="ai-guide-highlights" aria-label="Формат практикума">{block.highlights.map((highlight, index) => {
        const Icon = iconAt(highlightIcons, index);
        return <li key={highlight}><Icon aria-hidden="true" />{context.fill(highlight)}</li>;
      })}</ul>}
      <Link className="ai-guide-button" href={context.programme}>Открыть программу<ArrowRight /></Link>
      {context.freeCount > 0 ? <p className="ai-guide-format">Бесплатно: {formatMaterialCount(context.freeCount)}</p> : null}
    </div>
    <div className="ai-guide-artwork"><AiFirstProcessArtwork /></div>
  </header>;
}

function PlainCards({ block, fill }: { readonly block: GuidePageBlockOf<"cards">; readonly fill: (text: string) => string }) {
  return <section className="ai-guide-audience">
    <h2>{fill(block.title)}</h2>
    {block.lead === "" ? null : <p className="ai-guide-section-intro">{fill(block.lead)}</p>}
    <dl>{block.items.map(item => <div key={item.title}><dt><Check />{fill(item.title)}</dt><dd>{fill(item.text)}</dd></div>)}</dl>
    {block.note === "" ? null : <p className="ai-guide-career">{fill(block.note)}</p>}
  </section>;
}

function TextSection({ block, fill }: { readonly block: GuidePageBlockOf<"text">; readonly fill: (text: string) => string }) {
  return <section className="ai-guide-shift">
    <h2>{fill(block.title)}</h2>
    <div>{block.paragraphs.map(paragraph => <p key={paragraph}>{fill(paragraph)}</p>)}</div>
  </section>;
}

const outcomeIcons = [FolderGit2, Workflow, Server] as const;
const proofIcons = [FileCode2, Check, GitPullRequest] as const;
const outcomeVisuals: readonly ReactNode[] = [
  <div className="ai-guide-result-visual ai-guide-result-harness" aria-hidden="true" key="harness"><FolderGit2 /><strong>Твой проект</strong><div><span><FileCode2 />Инструкции и контекст</span><span><FileCode2 />Skills и инструменты</span><span><FileCode2 />Решения и проверки</span></div></div>,
  <div className="ai-guide-result-visual ai-guide-result-pipeline" aria-hidden="true" key="pipeline"><Workflow /><strong>От задачи до релиза</strong><div>{["Исследование и план", "Реализация и ревью", "Проверки и релиз"].map(label => <span key={label}><Check />{label}</span>)}</div></div>,
  <div className="ai-guide-result-visual ai-guide-result-project" aria-hidden="true" key="project"><Server /><strong>Проект в production</strong><div><span>Пользователи и доступ</span><span>Данные и AI-функции</span><span>Деплой и наблюдение</span></div></div>,
];
function OutcomeCards({ block, fill }: { readonly block: GuidePageBlockOf<"cards">; readonly fill: (text: string) => string }) {
  return <section className="ai-guide-outcomes">
    <h2>{fill(block.title)}</h2>
    {block.lead === "" ? null : <p className="ai-guide-section-intro ai-guide-promise">{fill(block.lead)}</p>}
    <div className="ai-guide-outcome-grid">{block.items.map((item, index) => {
      const Icon = iconAt(outcomeIcons, index);
      const Proof = iconAt(proofIcons, index);
      return <div key={item.title}>
        {outcomeVisuals[index] ?? null}
        <div className="ai-guide-result-copy"><h3><Icon aria-hidden="true" />{fill(item.title)}</h3><p>{fill(item.text)}</p>{item.detailLabel === "" && item.detail === "" ? null : <div className="ai-guide-result-proof"><Proof aria-hidden="true" /><span>{fill(item.detailLabel)}<strong>{fill(item.detail)}</strong></span></div>}</div>
      </div>;
    })}</div>
    {block.note === "" ? null : <p className="ai-guide-career">{fill(block.note)}</p>}
  </section>;
}

function StepsSection({ block, context }: { readonly block: GuidePageBlockOf<"steps">; readonly context: BlockContext }) {
  const titleId = `ai-${block.id}-title`;
  return <section className="ai-guide-programme" aria-labelledby={titleId}>
    <h2 id={titleId}>{context.fill(block.title)}</h2>
    {block.lead === "" ? null : <p>{context.fill(block.lead)}</p>}
    <ol>{block.items.map((stage, index) => <li key={stage.title}><span>{index + 1}</span><div><h3>{context.fill(stage.title)}</h3><p>{context.fill(stage.text)}</p></div></li>)}</ol>
    {block.link === "" ? null : <Link className="ai-guide-text-link" href={context.programme}>{context.fill(block.link)}<ArrowRight /></Link>}
  </section>;
}

function ListSection({ block, fill }: { readonly block: GuidePageBlockOf<"list">; readonly fill: (text: string) => string }) {
  return <section className="ai-guide-project">
    <div><h2>{fill(block.title)}</h2>{block.text === "" ? null : <p>{fill(block.text)}</p>}</div>
    <div className="ai-guide-language-map" aria-label="Практикум подходит для разных стеков">
      <ul className="ai-guide-languages">{block.items.map(language => <li key={language}>{fill(language)}</li>)}</ul>
      <div className="ai-guide-language-join" aria-hidden="true" />
      <div className="ai-guide-language-project"><FolderGit2 aria-hidden="true" /><span>Твой проект<small>Знакомый стек · новые навыки</small></span></div>
    </div>
  </section>;
}

const supportIcons = [MessagesSquare, Play, GitPullRequest] as const;
function SupportCards({ block, fill }: { readonly block: GuidePageBlockOf<"cards">; readonly fill: (text: string) => string }) {
  return <section className="ai-guide-support" id={block.id}>
    <div className="ai-guide-support-intro">{block.eyebrow === "" ? null : <p className="ai-guide-eyebrow">{fill(block.eyebrow)}</p>}<h2>{fill(block.title)}</h2>{block.lead === "" ? null : <p>{fill(block.lead)}</p>}</div>
    <div className="ai-guide-support-details">{block.items.map((item, index) => {
      const Icon = iconAt(supportIcons, index);
      return <div key={item.title}><Icon aria-hidden="true" /><h3>{fill(item.title)}</h3><p>{fill(item.text)}</p></div>;
    })}</div>
  </section>;
}

const bonusPreviews: readonly ReactNode[] = [
  <div className="ai-guide-bonus-preview ai-guide-bonus-video" aria-hidden="true" key="video"><span>Идея</span><ArrowRight /><Play /><ArrowRight /><span>Ролик</span></div>,
  <div className="ai-guide-bonus-preview ai-guide-bonus-code" aria-hidden="true" key="code"><FolderGit2 /><span>Код<br /><small>Решения · примеры · разборы</small></span></div>,
  <div className="ai-guide-bonus-preview ai-guide-bonus-questions" aria-hidden="true" key="questions"><MessagesSquare /><span>От вопроса к разбору</span></div>,
];
function BonusCards({ block, fill }: { readonly block: GuidePageBlockOf<"cards">; readonly fill: (text: string) => string }) {
  return <section className="ai-guide-bonuses">
    <h2>{fill(block.title)}</h2>
    {block.lead === "" ? null : <p className="ai-guide-section-intro">{fill(block.lead)}</p>}
    <div className="ai-guide-bonus-grid">{block.items.map((item, index) => <div key={item.title}>{bonusPreviews[index] ?? null}<h3>{fill(item.title)}</h3><p>{fill(item.text)}</p></div>)}</div>
  </section>;
}
