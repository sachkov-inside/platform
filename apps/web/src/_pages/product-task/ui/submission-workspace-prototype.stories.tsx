import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ProductTaskView } from "./product-task-view";
import { courseTask } from "@/storybook/course-reading.fixtures";
import {
  openProductTask,
  learnerMcpUrl,
  notSubmittedYet,
} from "@/storybook/product-task.fixtures";
import {
  publicPageEnvironment,
  PublicShellFrame,
} from "@/storybook/story-environment";
import styles from "./submission-workspace.prototype.module.css";

// Throwaway: compare three monochrome submission flows in the existing task page via ?variant=A|B|C.
const names = ["Пошаговый сценарий", "Дорожная карта", "Рабочая панель"];
const steps = ["Подключи MCP", "Передай запрос", "Подтверди сдачу"];
const phrase =
  "Проверь моё задание aie-ch1-onboarding через учебный MCP Sachkov Inside и помоги его сдать.";
const environment = publicPageEnvironment(
  "/products/ai-engineering/tasks/aie-ch1-onboarding",
);

type Phase = "empty" | "reviewing" | "ready" | "submitted";

function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={styles["primary"]}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? (
        <Check size={17} aria-hidden />
      ) : (
        <Copy size={17} aria-hidden />
      )}
      {copied ? "Скопировано" : label}
    </button>
  );
}

function Connection() {
  const [client, setClient] = useState("Claude Code");
  const [more, setMore] = useState(false);
  const command =
    client === "Claude Code"
      ? `claude mcp add --transport http learning ${learnerMcpUrl}`
      : client === "Codex"
        ? `codex mcp add learning --url ${learnerMcpUrl}`
        : learnerMcpUrl;
  return (
    <div className={styles["content"]}>
      <p>
        Подключи учебный MCP один раз для всех заданий. Войди тем же аккаунтом,
        что и на сайте.
      </p>
      <div className={styles["clientPicker"]} aria-label="Твой агент">
        {["Claude Code", "Codex", "Другой агент"].map((name) => (
          <button
            key={name}
            aria-pressed={client === name}
            onClick={() => {
              setClient(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className={styles["command"]}>
        <code>{command}</code>
        <CopyAction text={command} label="Скопировать" />
      </div>
      <button
        className={styles["textButton"]}
        aria-expanded={more}
        onClick={() => {
          setMore(!more);
        }}
      >
        {more ? (
          <Minus size={16} aria-hidden />
        ) : (
          <Plus size={16} aria-hidden />
        )}
        Как проверить подключение
      </button>
      {more && (
        <p className={styles["help"]}>
          Перезапусти агента и попроси показать доступные инструменты учебного
          MCP. Если агент предложит вход, открой ссылку и войди в аккаунт.
        </p>
      )}
    </div>
  );
}

function Request({ start }: { start: () => void }) {
  return (
    <div className={styles["content"]}>
      <p>
        Открой агента в папке проекта и отправь этот запрос. Агент получит
        задание и начнёт проверку.
      </p>
      <div className={styles["request"]}>
        <code>{phrase}</code>
        <CopyAction text={phrase} label="Скопировать запрос" />
      </div>
      <p className={styles["help"]}>
        Работай и обсуждай замечания у агента. Здесь появятся статус проверки и
        краткий отчёт.
      </p>
      <button className={styles["textButton"]} onClick={start}>
        <RefreshCw size={16} aria-hidden />
        Показать пример проверки
      </button>
    </div>
  );
}

function Confirmation({ ready }: { ready: () => void }) {
  return (
    <div className={styles["content"]}>
      <p>
        Агент покажет отчёт и предложит отправить работу. Обсуди замечания и
        подтверди отправку в той же сессии.
      </p>
      <div className={styles["expectation"]}>
        <Check size={20} aria-hidden />
        <p>Сдача появится на странице после твоего подтверждения агенту.</p>
      </div>
      <button className={styles["secondary"]} onClick={ready}>
        Посмотреть пример отчёта
        <ArrowRight size={16} aria-hidden />
      </button>
    </div>
  );
}

function History({
  phase,
  setPhase,
}: {
  phase: Phase;
  setPhase: (phase: Phase) => void;
}) {
  const [details, setDetails] = useState(false);
  const titles = {
    empty: "Пока нет сдач",
    reviewing: "Агент проверяет проект",
    ready: "Отчёт готов",
    submitted: "Работа отправлена",
  };
  return (
    <section className={styles["history"]} aria-label="Мои сдачи">
      <div className={styles["historyHeading"]}>
        <h3>Мои сдачи</h3>
        <span>Обновляется автоматически</span>
      </div>
      <div className={styles["historySurface"]} aria-live="polite">
        <div className={styles["historyTitle"]}>
          <span className={styles["statusDot"]} />
          <h4>{titles[phase]}</h4>
        </div>
        <p>
          {phase === "empty"
            ? "Начни проверку у агента. Здесь появятся её результат и ответ автора."
            : phase === "reviewing"
              ? "Агент изучает проект. Продолжай работу в его сессии — сюда он передаст краткий результат."
              : phase === "ready"
                ? "Основной сценарий работает. Осталось проверить отзыв доступа и обработку ошибки GitHub."
                : "Сдача №1 · Сегодня, 12:30. Здесь появится ответ автора."}
        </p>
        {(phase === "ready" || phase === "submitted") && (
          <>
            <p className={styles["help"]}>
              Самопроверка агента: 2 из 4 подтверждены · 1 с замечаниями · 1 не
              проверен
            </p>
            <button
              className={styles["textButton"]}
              aria-expanded={details}
              onClick={() => {
                setDetails(!details);
              }}
            >
              {details ? (
                <Minus size={16} aria-hidden />
              ) : (
                <Plus size={16} aria-hidden />
              )}
              Отчёт по критериям
            </button>
            {details && (
              <ul className={styles["criteria"]}>
                <li>Вход и основной сценарий — подтверждено</li>
                <li>Выдача доступа — подтверждено</li>
                <li>Обработка ошибки GitHub — с замечаниями</li>
                <li>Отзыв доступа — не проверено</li>
              </ul>
            )}
          </>
        )}
        {phase === "reviewing" && (
          <button
            className={styles["secondary"]}
            onClick={() => {
              setPhase("ready");
            }}
          >
            Показать готовый отчёт
          </button>
        )}
        {phase === "ready" && (
          <p className={styles["pending"]}>
            Ещё не отправлено. Подтверди отправку у агента.
          </p>
        )}
      </div>
    </section>
  );
}

function Wizard({ setPhase }: { setPhase: (phase: Phase) => void }) {
  const [step, setStep] = useState(0);
  return (
    <section className={styles["wizard"]} aria-label="Сдача задания">
      <header className={styles["wizardHeader"]}>
        <h2>Сдача задания</h2>
        <p>Три шага. Проверяет и отправляет твой агент.</p>
        <div className={styles["segments"]}>
          {steps.map((name, index) => (
            <button
              key={name}
              aria-current={step === index ? "step" : undefined}
              onClick={() => {
                setStep(index);
              }}
            >
              <span />
              <small>
                {index + 1}. {name}
              </small>
            </button>
          ))}
        </div>
      </header>
      <div className={styles["wizardBody"]}>
        <h3>{steps[step]}</h3>
        {step === 0 ? (
          <Connection />
        ) : step === 1 ? (
          <Request
            start={() => {
              setPhase("reviewing");
            }}
          />
        ) : (
          <Confirmation
            ready={() => {
              setPhase("ready");
            }}
          />
        )}
        <div className={styles["wizardFooter"]}>
          <span>Шаг {step + 1} из 3</span>
          {step < 2 ? (
            <button
              className={styles["primary"]}
              onClick={() => {
                setStep(step + 1);
              }}
            >
              {step === 0 ? "MCP подключён" : "Запрос передан"}
              <ArrowRight size={17} aria-hidden />
            </button>
          ) : (
            <button
              className={styles["textButton"]}
              onClick={() => {
                setStep(0);
              }}
            >
              Вернуться к подключению
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Roadmap({ setPhase }: { setPhase: (phase: Phase) => void }) {
  const [open, setOpen] = useState(1);
  return (
    <section className={styles["roadmap"]} aria-label="Сдача задания">
      <header>
        <h2>Сдай работу с агентом</h2>
        <p>Подключи, проверь, подтверди. Всё обсуждение — у твоего агента.</p>
      </header>
      <ol className={styles["roadmapList"]}>
        {steps.map((title, index) => (
          <li
            key={title}
            className={open === index ? styles["activeRow"] : undefined}
          >
            <span className={styles["stepNumber"]}>{index + 1}</span>
            <div className={styles["roadmapStep"]}>
              <button
                className={styles["stepTitle"]}
                aria-expanded={open === index}
                onClick={() => {
                  setOpen(open === index ? -1 : index);
                }}
              >
                <h3>{title}</h3>
                {open === index ? (
                  <Minus size={20} aria-hidden />
                ) : (
                  <Plus size={20} aria-hidden />
                )}
              </button>
              {open === index ? (
                index === 0 ? (
                  <Connection />
                ) : index === 1 ? (
                  <Request
                    start={() => {
                      setPhase("reviewing");
                    }}
                  />
                ) : (
                  <Confirmation
                    ready={() => {
                      setPhase("ready");
                    }}
                  />
                )
              ) : (
                <p className={styles["stepSummary"]}>
                  {
                    [
                      "Один раз для всех заданий",
                      "Агент получит требования и проверит проект",
                      "Изучи отчёт и подтверди отправку у агента",
                    ][index]
                  }
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Workbench({
  phase,
  setPhase,
}: {
  phase: Phase;
  setPhase: (phase: Phase) => void;
}) {
  const [connect, setConnect] = useState(false);
  return (
    <>
      <section className={styles["workbench"]} aria-label="Сдача задания">
        <header>
          <h2>От задания — к сдаче</h2>
          <p>Твой агент проверяет. Ты решаешь, когда отправить.</p>
        </header>
        <div className={styles["workbenchFlow"]}>
          {steps.map((step, i) => (
            <span key={step}>
              <b>{i + 1}</b>
              {step}
              {i < 2 && <ArrowRight size={15} aria-hidden />}
            </span>
          ))}
        </div>
        <div className={styles["workbenchColumns"]}>
          <div className={styles["launch"]}>
            <h3>Начни с запроса</h3>
            <p>Отправь его агенту в папке проекта.</p>
            <code>{phrase}</code>
            <CopyAction text={phrase} label="Скопировать запрос" />
            <button
              className={styles["textButton"]}
              aria-expanded={connect}
              onClick={() => {
                setConnect(!connect);
              }}
            >
              {connect ? (
                <Minus size={16} aria-hidden />
              ) : (
                <Plus size={16} aria-hidden />
              )}
              Сначала подключить MCP
            </button>
          </div>
          <aside className={styles["next"]}>
            <h3>Что дальше</h3>
            <p>Агент изучит проект и покажет отчёт в сессии.</p>
            <p>Обсуди замечания. Затем подтверди отправку агенту.</p>
            <button
              className={styles["secondary"]}
              onClick={() => {
                setPhase(phase === "empty" ? "reviewing" : "ready");
              }}
            >
              Посмотреть, как это выглядит
              <ArrowRight size={16} aria-hidden />
            </button>
          </aside>
        </div>
        {connect && (
          <div className={styles["workbenchSetup"]}>
            <Connection />
          </div>
        )}
      </section>
    </>
  );
}

function SubmissionPrototype() {
  const host = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [variant, setVariant] = useState(0);
  const [phase, setPhase] = useState<Phase>("empty");
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    setTarget(host.current?.querySelector<HTMLElement>("#task-submit") ?? null);
    const sync = () => {
      const value = new URL(location.href).searchParams.get("variant");
      setVariant(value === "B" ? 1 : value === "C" ? 2 : 0);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("popstate", sync);
    };
  }, []);
  function change(value: number) {
    const next = (value + 3) % 3;
    setVariant(next);
    setPhase("empty");
    const url = new URL(location.href);
    url.searchParams.set("variant", ["A", "B", "C"][next] ?? "A");
    history.replaceState(null, "", url);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const element = event.target;
      if (
        element instanceof HTMLElement &&
        element.closest(
          "input,textarea,select,[contenteditable=true],[role=tablist]",
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        change(variant + (event.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  }, [variant]);
  return (
    <div ref={host} className={styles["host"]}>
      <ProductTaskView
        page={openProductTask}
        programme={courseTask}
        submissions={notSubmittedYet}
        learnerMcpUrl={learnerMcpUrl}
        returnTo="/products/ai-engineering/tasks/aie-ch1-onboarding"
        liveSubmissions={false}
      />
      {target &&
        createPortal(
          <div
            className={styles["prototype"]}
            data-submission-prototype
            key={variant}
          >
            {variant === 0 ? (
              <Wizard setPhase={setPhase} />
            ) : variant === 1 ? (
              <Roadmap setPhase={setPhase} />
            ) : (
              <Workbench phase={phase} setPhase={setPhase} />
            )}
            <History phase={phase} setPhase={setPhase} />
            <button
              className={styles["fallback"]}
              aria-expanded={fallback}
              onClick={() => {
                setFallback(!fallback);
              }}
            >
              {fallback ? (
                <Minus size={16} aria-hidden />
              ) : (
                <Plus size={16} aria-hidden />
              )}
              Нет агента с MCP? Сдать через форму
            </button>
            {fallback && (
              <p className={styles["help"]}>
                Здесь откроется запасная форма сдачи с заметкой для автора.
              </p>
            )}
          </div>,
          target,
        )}
      {process.env.NODE_ENV !== "production" && (
        <nav className={styles["switcher"]} aria-label="Варианты прототипа">
          <button
            aria-label="Предыдущий вариант"
            onClick={() => {
              change(variant - 1);
            }}
          >
            <ArrowLeft size={19} />
          </button>
          <div>
            <small>Прототип · данные примера</small>
            <strong>
              {["A", "B", "C"][variant]} · {names[variant]}
            </strong>
          </div>
          <button
            aria-label="Следующий вариант"
            onClick={() => {
              change(variant + 1);
            }}
          >
            <ArrowRight size={19} />
          </button>
          <button
            className={styles["reset"]}
            aria-label="Сбросить пример"
            onClick={() => {
              setPhase("empty");
            }}
          >
            <RefreshCw size={17} />
          </button>
        </nav>
      )}
    </div>
  );
}

const meta = {
  title: "Prototypes/Task Submission",
  component: SubmissionPrototype,
  beforeEach: environment.beforeEach,
  parameters: environment.parameters,
  decorators: [
    (Story) => (
      <PublicShellFrame
        account="authenticated"
        currentPath="/products/ai-engineering/tasks/aie-ch1-onboarding"
      >
        <Story />
      </PublicShellFrame>
    ),
  ],
} satisfies Meta<typeof SubmissionPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compare: Story = {};
