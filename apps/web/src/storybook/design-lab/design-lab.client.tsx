"use client";

/** Prototype #1468. Operate mode; inherit Inside tokens, primitives and typography.
 * Compare task topology, not a new visual identity. All content and mutations are fixtures.
 * First viewport: overview at left, one comparison at right, explicit variant and demo controls.
 * Workspace A keeps Product sections beside the content; B starts from a Product overview.
 */
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  FlaskConical,
  LayoutPanelLeft,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Workspace } from "./workspace.prototype";
import { NextAction } from "./next-action.prototype";
import { CreationForm } from "./creation-form.prototype";
import { Upload } from "./upload.prototype";

type Scenario = "overview" | "workspace" | "next" | "form" | "upload";
const scenarios = [
  {
    id: "workspace",
    title: "Рабочее пространство",
    description: "Найти материал, участников и доступ в контексте продукта.",
    question: "Что удобнее: разделы рядом с материалами или обзор продукта?",
    variants: [
      "Текущий редактор",
      "A · Разделы продукта",
      "B · Обзор продукта",
    ],
  },
  {
    id: "next",
    title: "Следующее действие",
    description:
      "Подготовить продукт и начать обучение без поиска следующего шага.",
    question: "Помогает ли явное следующее действие закончить подготовку?",
    variants: ["Текущий вход", "Явный следующий шаг"],
  },
  {
    id: "form",
    title: "Создание продукта",
    description:
      "Заполнить форму, исправить адрес и сохранить введённые данные.",
    question: "Понятно ли, что исправить и как продолжить после ошибки?",
    variants: ["Текущая форма", "Группы и ошибки у поля"],
  },
  {
    id: "upload",
    title: "Результат загрузки",
    description: "Сравнить обычный индикатор и Sileo на одном файле.",
    question: "Помогает ли уведомление заметить результат, сохраняя фокус?",
    variants: ["Текст и индикатор", "Sileo"],
  },
] as const;

function initialView(fallback: Scenario) {
  const candidate = new URLSearchParams(window.location.search).get("scenario");
  return scenarios.find(({ id }) => id === candidate)?.id ?? fallback;
}

export function DesignLab({
  initialScenario = "overview",
}: {
  readonly initialScenario?: Scenario;
}) {
  const [scenario, setScenario] = useState<Scenario>(() =>
    initialView(initialScenario),
  );
  const [variant, setVariant] = useState(() =>
    Number(new URLSearchParams(window.location.search).get("variant") ?? 0),
  );
  const [revision, setRevision] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const comparison = scenarios.find(({ id }) => id === scenario);
  const currentVariant =
    comparison === undefined
      ? 0
      : Math.min(
          Math.max(Number.isInteger(variant) ? variant : 0, 0),
          comparison.variants.length - 1,
        );
  function navigate(next: Scenario, nextVariant = 0) {
    setScenario(next);
    setVariant(nextVariant);
    const url = new URL(window.location.href);
    url.searchParams.set("scenario", next);
    url.searchParams.set("variant", String(nextVariant));
    window.history.replaceState(null, "", url);
  }
  return (
    <div className="lab" lang="ru">
      <a className="lab-skip" href="#lab-content">
        К сравнению
      </a>
      <header className="lab-header">
        <button
          type="button"
          className="lab-brand"
          onClick={() => {
            navigate("overview");
          }}
        >
          <FlaskConical aria-hidden="true" size={20} />
          <strong>Inside</strong>
          <span>Дизайн-лаборатория</span>
        </button>
        <span className="lab-fixture">Прототип · демонстрационные данные</span>
      </header>
      <div className="lab-layout">
        <aside className="lab-sidebar">
          <nav aria-label="Сравнения">
            <button
              type="button"
              aria-current={scenario === "overview" ? "page" : undefined}
              onClick={() => {
                navigate("overview");
              }}
            >
              <LayoutPanelLeft aria-hidden="true" size={18} />
              Обзор лаборатории
            </button>
            {scenarios.map(({ id, title }, index) => (
              <button
                type="button"
                key={id}
                aria-current={scenario === id ? "page" : undefined}
                onClick={() => {
                  navigate(id);
                }}
              >
                <span className="lab-nav-index">{index + 1}</span>
                {title}
              </button>
            ))}
          </nav>
          <div className="lab-sidebar-note">
            <BookOpen aria-hidden="true" size={18} />
            <p>Одна задача, одинаковые данные, разные способы её решить.</p>
            <p>Изменения не затрагивают приложение.</p>
          </div>
        </aside>
        <main id="lab-content" className="lab-content">
          {comparison === undefined ? (
            <>
              <div className="lab-overview-intro">
                <h1>Как будет удобнее работать?</h1>
                <p>
                  Четыре сравнения интерфейса Inside. Переключайте варианты,
                  проверяйте ошибки и выбирайте направление.
                </p>
              </div>
              <div className="lab-experiments">
                {scenarios.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    className="lab-experiment"
                    onClick={() => {
                      navigate(item.id);
                    }}
                  >
                    <span className="lab-experiment-index">{index + 1}</span>
                    <div>
                      <h2>{item.title}</h2>
                      <p>{item.description}</p>
                      <span>
                        {item.variants.length} варианта
                        {decisions[item.id] === undefined
                          ? " · Решение не принято"
                          : ` · ${decisions[item.id] ?? ""}`}
                      </span>
                    </div>
                    <ArrowRight aria-hidden="true" size={21} />
                  </button>
                ))}
              </div>
              <section className="lab-review-note">
                <h2>Что проверяем</h2>
                <p>
                  Рабочее пространство продукта, подготовку и начало обучения,
                  восстановление после ошибки формы и результат загрузки.
                </p>
                <p>
                  Платежи, Telegram, сохранение и загрузки здесь имитируются.
                  Решения сохраняются только до обновления страницы.
                </p>
                <p>
                  Выбор структуры редактора остаётся открытым в #1448. Публичное
                  чтение отделено от редактирования.
                </p>
              </section>
            </>
          ) : (
            <>
              <div className="lab-comparison-heading">
                <div>
                  <button
                    type="button"
                    className="lab-back"
                    onClick={() => {
                      navigate("overview");
                    }}
                  >
                    <ArrowLeft aria-hidden="true" size={15} />
                    Все сравнения
                  </button>
                  <h1>{comparison.title}</h1>
                  <p>{comparison.question}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRevision(revision + 1);
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                  Сбросить пример
                </Button>
              </div>
              <div
                className="lab-variants"
                role="group"
                aria-label="Вариант интерфейса"
              >
                {comparison.variants.map((label, index) => (
                  <button
                    type="button"
                    key={label}
                    aria-pressed={currentVariant === index}
                    onClick={() => {
                      navigate(scenario, index);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="lab-stage"
                key={`${scenario}-${String(revision)}`}
              >
                {scenario === "workspace" ? (
                  <Workspace variant={currentVariant} />
                ) : scenario === "next" ? (
                  <NextAction variant={currentVariant} />
                ) : scenario === "form" ? (
                  <CreationForm variant={currentVariant} />
                ) : (
                  <Upload variant={currentVariant} />
                )}
              </div>
              <footer className="lab-verdict">
                <div>
                  <strong>Ваше решение</strong>
                  <p>
                    Относится к варианту «{comparison.variants[currentVariant]}
                    ».
                  </p>
                </div>
                <div role="group" aria-label="Оценка варианта">
                  {["Оставить", "Доработать", "Отклонить"].map((verdict) => (
                    <Button
                      key={verdict}
                      variant="outline"
                      aria-pressed={
                        decisions[`${scenario}-${String(currentVariant)}`] ===
                        verdict
                      }
                      onClick={() => {
                        setDecisions({
                          ...decisions,
                          [`${scenario}-${String(currentVariant)}`]: verdict,
                          [scenario]: verdict,
                        });
                      }}
                    >
                      {decisions[`${scenario}-${String(currentVariant)}`] ===
                      verdict ? (
                        <Check aria-hidden="true" />
                      ) : null}
                      {verdict}
                    </Button>
                  ))}
                </div>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
