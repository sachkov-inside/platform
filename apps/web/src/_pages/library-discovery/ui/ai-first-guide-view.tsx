import { ArrowLeft, ArrowRight, Check, Clock3, Code2, FileCode2, FolderGit2, GitPullRequest, MessagesSquare, Play, Server, Workflow } from "lucide-react";
import { oneTimePurchaseTerms } from "@inside/legal/purchase-terms";
import type { Route } from "next";
import Link from "next/link";

import { formatMonths, formatYears } from "@/entities/subscription";
import { AiFirstProcessArtwork, aiFirstGuide } from "@/features/ai-first-guide";
import { formatMaterialCount, type PublishedSeriesResult } from "@/features/library-discovery";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { guideProgrammeHref } from "@/shared/routing/subscription-route";

import "./ai-first-guide-view.css";

// Сроки называет действующая оферта разовой покупки: страница повторяет их, а не пишет свои.
const accessTerm = formatYears(oneTimePurchaseTerms.materialsAndChatYears);
const supportTerm = formatMonths(oneTimePurchaseTerms.supportMonths);

export function AiFirstGuideView({ result, returnTarget, freeEntryHref }: {
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly freeEntryHref?: Route;
}) {
  const freeCount = result.kind === "ready" ? result.items.filter(item => item.access === "free" && item.availability === "available").length : 0;
  const programme = guideProgrammeHref(result.reference.slug);
  return <article className="ai-guide-page" data-guide-product={result.reference.slug}>
    <nav aria-label="Хлебные крошки"><Link className="ai-guide-back" href={returnTarget.href}><ArrowLeft />{returnTarget.label}</Link></nav>
    <header className="ai-guide-hero">
      <div className="ai-guide-hero-copy">
        <h1>{result.reference.name}</h1>
        <p className="ai-guide-intro">Практикум, на котором ты построишь свой процесс работы с AI-агентами и применишь инженерные навыки на проекте — от задачи до продакшена.</p>
        <ul className="ai-guide-highlights" aria-label="Формат практикума">
          <li><Code2 aria-hidden="true" />Твой стек</li>
          <li><Clock3 aria-hidden="true" />В своём темпе</li>
          <li><MessagesSquare aria-hidden="true" />Поддержка {supportTerm}</li>
        </ul>
        <Link className="ai-guide-button" href={programme}>Открыть программу<ArrowRight /></Link>
        {freeCount > 0 ? <p className="ai-guide-format">Бесплатно: {formatMaterialCount(freeCount)}</p> : null}
      </div>
      <div className="ai-guide-artwork"><AiFirstProcessArtwork /></div>
    </header>

    <section className="ai-guide-audience">
      <h2>Кому это нужно</h2>
      <dl>{aiFirstGuide.audience.map(item => <div key={item.title}><dt><Check />{item.title}</dt><dd>{item.text}</dd></div>)}</dl>
    </section>

    <section className="ai-guide-shift">
      <h2>Работа разработчика меняется</h2>
      <div><p>Команды уже включают AI в разработку. Вместе с инструментами меняются рабочие процессы: агенту можно поручить исследование, реализацию и проверку изменений.</p><p>Важно уметь управлять этой работой: давать контекст, получать от агента обратную связь, проверять его решения и доводить задачи до релиза. Именно это отличает инженерную работу от вайбкодинга: ты разбираешься в задаче, понимаешь ограничения и отвечаешь за надёжность решения.</p></div>
    </section>

    <section className="ai-guide-outcomes">
      <h2>Что получится</h2>
      <p className="ai-guide-section-intro ai-guide-promise">Доведёшь проект до продакшена и научишься самостоятельно развивать его с AI-агентами: разбирать задачи, выбирать решения, проверять код и выпускать обновления через надёжный пайплайн.</p>
      <div className="ai-guide-outcome-grid">
        <div>
          <div className="ai-guide-result-visual ai-guide-result-harness" aria-hidden="true"><FolderGit2 /><strong>Твой проект</strong><div><span><FileCode2 />Инструкции и контекст</span><span><FileCode2 />Skills и инструменты</span><span><FileCode2 />Решения и проверки</span></div></div>
          <div className="ai-guide-result-copy"><h3><FolderGit2 aria-hidden="true" />Свой harness</h3><p>Среда агента, которую можно переносить в следующие проекты.</p><div className="ai-guide-result-proof"><FileCode2 aria-hidden="true" /><span>В репозитории<strong>Контекст · инструкции · инструменты</strong></span></div></div>
        </div>
        <div>
          <div className="ai-guide-result-visual ai-guide-result-pipeline" aria-hidden="true"><Workflow /><strong>От задачи до релиза</strong><div>{["Исследование и план", "Реализация и ревью", "Проверки и релиз"].map(label => <span key={label}><Check />{label}</span>)}</div></div>
          <div className="ai-guide-result-copy"><h3><Workflow aria-hidden="true" />Надёжный пайплайн</h3><p>Ты знаешь, что поручить агенту, когда вмешаться и как принять результат.</p><div className="ai-guide-result-proof"><Check aria-hidden="true" /><span>Перед релизом<strong>Тесты → ревью → CI/CD</strong></span></div></div>
        </div>
        <div>
          <div className="ai-guide-result-visual ai-guide-result-project" aria-hidden="true"><Server /><strong>Проект в production</strong><div><span>Пользователи и доступ</span><span>Данные и AI-функции</span><span>Деплой и наблюдение</span></div></div>
          <div className="ai-guide-result-copy"><h3><Server aria-hidden="true" />Проект и инженерный опыт</h3><p>Работающий проект, решения которого ты можешь объяснить, проверить и развивать.</p><div className="ai-guide-result-proof"><GitPullRequest aria-hidden="true" /><span>После релиза<strong>Метрики · логи · обновления</strong></span></div></div>
        </div>
      </div>
      <p className="ai-guide-career">Эти навыки пригодятся при поиске работы в backend и fullstack разработке, в работе над продакшен-проектами в команде и в собственных проектах. Они также станут основой для дальнейшего развития в AI engineering.</p>
    </section>

    <section className="ai-guide-programme" aria-labelledby="ai-programme-title">
      <h2 id="ai-programme-title">Что внутри практикума</h2>
      <p>От основ работы агента до самостоятельного релиза.</p>
      <ol>{aiFirstGuide.stages.map((stage, index) => <li key={stage.title}><span>{index + 1}</span><div><h3>{stage.title}</h3><p>{stage.text}</p></div></li>)}</ol>
      <Link className="ai-guide-text-link" href={programme}>Посмотреть главы и материалы<ArrowRight /></Link>
    </section>

    <section className="ai-guide-project">
      <div><h2>Работай на знакомом стеке</h2><p>На выбранном стеке ты будешь разрабатывать проект с AI-агентами и учиться принимать инженерные решения.</p></div>
      <div className="ai-guide-language-map" aria-label="Практикум подходит для разных стеков">
        <ul className="ai-guide-languages">{["TypeScript", "Python", "C#", "Java", "Go", "Другой язык"].map(language => <li key={language}>{language}</li>)}</ul>
        <div className="ai-guide-language-join" aria-hidden="true" />
        <div className="ai-guide-language-project"><FolderGit2 aria-hidden="true" /><span>Твой проект<small>Знакомый стек · новые навыки</small></span></div>
      </div>
    </section>

    <section className="ai-guide-support" id="support">
      <div className="ai-guide-support-intro"><p className="ai-guide-eyebrow">Кирилл Сачков · автор практикума</p><h2>Моё сопровождение и закрытое сообщество</h2><p>После покупки сразу открываются все опубликованные материалы практикума и закрытое сообщество — на {accessTerm} гарантированно, без продлений и доплат; дальше доступ может сохраняться, но без гарантии срока. Моё сопровождение — {supportTerm} с покупки. Проходи материалы в своём темпе и возвращайся к практике, когда удобно.</p></div>
      <div className="ai-guide-support-details">
        <div><MessagesSquare aria-hidden="true" /><h3>Моя помощь в сообществе</h3><p>Задавай вопросы и приноси решения на обсуждение. Я помогу разобраться с задачей и выбрать следующий шаг. Моя помощь — {supportTerm} с покупки; личные встречи и обязательная проверка кода в неё не входят.</p></div>
        <div><Play aria-hidden="true" /><h3>Видео и разборы</h3><p>Показываю свой процесс разработки и объясняю решения на примерах. Сложные темы дополняю разборами и видео.</p></div>
        <div><GitPullRequest aria-hidden="true" /><h3>Практика вместе с участниками</h3><p>Обсуждай проекты, делись находками и учись на опыте других. Время от времени проводим общие разборы сложных тем.</p></div>
      </div>
    </section>

    <section className="ai-guide-bonuses">
      <h2>Бонусные материалы</h2>
      <p className="ai-guide-section-intro">Моя практика за пределами основной программы. Эти материалы буду добавлять в практикум по мере подготовки. Срок появления не назначен: в покупку входят уже опубликованные материалы, новые открываются без доплаты.</p>
      <div className="ai-guide-bonus-grid">
        <div><div className="ai-guide-bonus-preview ai-guide-bonus-video" aria-hidden="true"><span>Идея</span><ArrowRight /><Play /><ArrowRight /><span>Ролик</span></div><h3>Как я делаю шортсы с AI</h3><p>Разбор моего процесса: от идеи и сценария до сборки ролика с помощью агентов.</p></div>
        <div><div className="ai-guide-bonus-preview ai-guide-bonus-code" aria-hidden="true"><FolderGit2 /><span>Код<br /><small>Решения · примеры · разборы</small></span></div><h3>Мои проекты и репозитории</h3><p>Доступ к репозиториям с примерами и разборы моих проектов: как они устроены, какие решения я принимаю и как работаю с агентами.</p></div>
        <div><div className="ai-guide-bonus-preview ai-guide-bonus-questions" aria-hidden="true"><MessagesSquare /><span>От вопроса к разбору</span></div><h3>Разборы по вашим вопросам</h3><p>Вопросы участников помогают дополнять практикум: записываю объяснения, добавляю примеры и улучшаю материалы.</p></div>
      </div>
    </section>

    {freeEntryHref === undefined ? null : <section className="ai-guide-trial"><h2>Посмотри, как устроено обучение</h2><p>Открой всю программу и начни с бесплатных уроков. Познакомишься с подходом и решишь, подходит ли тебе практикум.</p><Link className="ai-guide-text-link" href={programme}>Посмотреть бесплатные уроки<ArrowRight /></Link></section>}

    <div className="ai-guide-sticky"><Link className="ai-guide-button" href={programme}>Открыть программу<ArrowRight /></Link></div>
  </article>;
}
