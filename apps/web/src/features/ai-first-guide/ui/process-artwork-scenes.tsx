import {
  Activity,
  AppWindow,
  ArrowUp,
  Braces,
  Check,
  Code,
  Database,
  Eye,
  FileText,
  GitBranch,
  Layers,
  List,
  ListChecks,
  Package,
  ScrollText,
  Search,
  Server,
  Sparkles,
  User,
  UserCheck,
  X,
} from "lucide-react";
import { type CSSProperties, useId } from "react";

// The accepted stage-template from #614/#616. Keep scene composition and timing together.
const artworkStyle = (value: CSSProperties & Record<`--${string}`, string>) =>
  value;

export function ProcessArtworkScenes() {
  const gradientId = useId();
  return (
    <div
      className="stage"
      role="img"
      aria-label="Иллюстрация AI-first процесса: контекст и агенты, харнес и пайплайн, архитектура, проверка результата, релиз и эксплуатация."
    >
      <div className="glow" aria-hidden="true"></div>
      <div className="stage-body" aria-hidden="true">
        <section className="scene scene-1">
          <div className="docs">
            <span
              className="chip a-left"
              style={artworkStyle({ "--t": "300ms" })}
            >
              <FileText className="ico" />
              AGENTS.md
            </span>
            <span
              className="chip a-left"
              style={artworkStyle({ "--t": "460ms" })}
            >
              <FileText className="ico" />
              spec.md
            </span>
            <span
              className="chip a-left"
              style={artworkStyle({ "--t": "620ms" })}
            >
              <FileText className="ico" />
              tasks.md
            </span>
          </div>
          <div
            className="prompt panel a-up"
            style={artworkStyle({ "--t": "420ms" })}
          >
            <span className="who">
              <User className="ico" />
              ты
            </span>
            <span className="text">
              <span className="type" data-t="900" data-speed="32">
                Добавь уведомления о новых заявках
              </span>
              <i className="caret"></i>
            </span>
            <span className="send" style={artworkStyle({ "--t": "2100ms" })}>
              <ArrowUp className="ico" />
            </span>
          </div>
          <div className="agents">
            <div
              className="agent panel a-drop"
              style={artworkStyle({ "--t": "2500ms" })}
            >
              <header>
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--lavender)" })}
                >
                  <Search className="ico" />
                </i>
                <span
                  className="status"
                  style={artworkStyle({ "--t": "2800ms", "--done": "3350ms" })}
                >
                  <i className="spin"></i>
                  <i className="ok">
                    <Check className="ico" />
                  </i>
                </span>
              </header>
              <span className="name">Исследование</span>
              <div
                className="bar"
                style={artworkStyle({ "--bar": "var(--lavender)" })}
              >
                <i
                  style={artworkStyle({ "--t": "2800ms", "--dur": ".5s" })}
                ></i>
              </div>
            </div>
            <div
              className="agent panel a-drop"
              style={artworkStyle({ "--t": "2660ms" })}
            >
              <header>
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--accent)" })}
                >
                  <Code className="ico" />
                </i>
                <span
                  className="status"
                  style={artworkStyle({ "--t": "2900ms", "--done": "3750ms" })}
                >
                  <i className="spin"></i>
                  <i className="ok">
                    <Check className="ico" />
                  </i>
                </span>
              </header>
              <span className="name">Реализация</span>
              <div
                className="bar"
                style={artworkStyle({ "--bar": "var(--accent)" })}
              >
                <i
                  style={artworkStyle({ "--t": "2900ms", "--dur": ".8s" })}
                ></i>
              </div>
            </div>
            <div
              className="agent panel a-drop"
              style={artworkStyle({ "--t": "2820ms" })}
            >
              <header>
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--mint)" })}
                >
                  <Eye className="ico" />
                </i>
                <span
                  className="status"
                  style={artworkStyle({ "--t": "3000ms", "--done": "9000ms" })}
                >
                  <i className="spin"></i>
                  <i className="ok">
                    <Check className="ico" />
                  </i>
                </span>
              </header>
              <span className="name">Ревью</span>
              <div
                className="bar"
                style={artworkStyle({ "--bar": "var(--mint)" })}
              >
                <i
                  style={artworkStyle({
                    "--t": "3000ms",
                    "--dur": "1.4s",
                    "--to": ".55",
                  })}
                ></i>
              </div>
            </div>
          </div>
        </section>

        <section className="scene scene-2">
          <div className="lane">
            <i
              className="lane-line"
              style={artworkStyle({ "--t": "500ms" })}
            ></i>
            <i className="lane-tick" style={artworkStyle({ left: "10%" })}></i>
            <i className="lane-tick" style={artworkStyle({ left: "30%" })}></i>
            <i className="lane-tick" style={artworkStyle({ left: "50%" })}></i>
            <i className="lane-tick" style={artworkStyle({ left: "70%" })}></i>
            <i className="lane-tick" style={artworkStyle({ left: "90%" })}></i>
            <span
              className="token-anchor a-fade"
              style={artworkStyle({ "--t": "800ms" })}
            >
              <span className="token" style={artworkStyle({ "--t": "900ms" })}>
                Задача
              </span>
            </span>
          </div>
          <div className="stages">
            <div
              className="stage-block stage-research panel a-pop"
              style={artworkStyle({ "--t": "0ms" })}
            >
              <i
                className="well"
                style={artworkStyle({
                  "--c": "var(--lavender)",
                  "--lit": "900ms",
                })}
              >
                <Search className="ico" />
              </i>
              <span className="name">
                Исследо
                <wbr />
                вание
              </span>
            </div>
            <div
              className="stage-block panel a-pop"
              style={artworkStyle({ "--t": "120ms" })}
            >
              <i
                className="well"
                style={artworkStyle({
                  "--c": "var(--amber)",
                  "--lit": "1340ms",
                })}
              >
                <FileText className="ico" />
              </i>
              <span className="name">
                Специфи
                <wbr />
                кация
              </span>
            </div>
            <div
              className="stage-block panel a-pop"
              style={artworkStyle({ "--t": "240ms" })}
            >
              <i
                className="well"
                style={artworkStyle({
                  "--c": "var(--amber)",
                  "--lit": "1780ms",
                })}
              >
                <ListChecks className="ico" />
              </i>
              <span className="name">Задачи</span>
            </div>
            <div
              className="stage-block stage-build panel a-pop"
              style={artworkStyle({ "--t": "360ms" })}
            >
              <i
                className="well"
                style={artworkStyle({
                  "--c": "var(--accent)",
                  "--lit": "2220ms",
                })}
              >
                <Code className="ico" />
              </i>
              <span className="name">
                Реали
                <wbr />
                зация
              </span>
            </div>
            <div
              className="stage-block stage-review panel a-pop"
              style={artworkStyle({ "--t": "480ms" })}
            >
              <i
                className="well"
                style={artworkStyle({
                  "--c": "var(--mint)",
                  "--lit": "2660ms",
                })}
              >
                <Eye className="ico" />
              </i>
              <span className="name">Ревью</span>
            </div>
          </div>
          <div className="foundation">
            <span
              className="foundation-label a-fade"
              style={artworkStyle({ "--t": "500ms" })}
            >
              <Layers className="ico" />
              Харнес
            </span>
            <span
              className="chip a-pop"
              style={artworkStyle({ "--t": "560ms" })}
            >
              <FileText className="ico" />
              AGENTS.md
            </span>
            <span
              className="chip a-pop"
              style={artworkStyle({ "--t": "660ms" })}
            >
              <FileText className="ico" />
              spec.md
            </span>
            <span
              className="chip a-pop"
              style={artworkStyle({ "--t": "760ms" })}
            >
              <FileText className="ico" />
              tasks.md
            </span>
            <span
              className="chip a-pop"
              style={artworkStyle({ "--t": "860ms" })}
            >
              skills
            </span>
            <span
              className="chip a-pop"
              style={artworkStyle({ "--t": "960ms" })}
            >
              MCP
            </span>
          </div>
        </section>

        <section className="scene scene-3">
          <div className="diagram">
            <svg viewBox="0 0 100 64">
              <g className="edges">
                <path
                  className="draw"
                  pathLength="1"
                  d="M50 19.2L16 16.6"
                  style={artworkStyle({ "--t": "600ms", "--dur": ".6s" })}
                />
                <path
                  className="draw"
                  pathLength="1"
                  d="M50 19.2L84 16.6"
                  style={artworkStyle({ "--t": "750ms", "--dur": ".6s" })}
                />
                <path
                  className="draw"
                  pathLength="1"
                  d="M50 19.2L72 46"
                  style={artworkStyle({ "--t": "900ms", "--dur": ".6s" })}
                />
                <path
                  className="draw"
                  pathLength="1"
                  d="M72 46L28 46"
                  style={artworkStyle({ "--t": "1050ms", "--dur": ".6s" })}
                />
                <path
                  className="draw"
                  pathLength="1"
                  d="M28 46L50 19.2"
                  style={artworkStyle({ "--t": "1200ms", "--dur": ".6s" })}
                />
              </g>
              <g className="packets">
                <circle
                  className="packet"
                  style={artworkStyle({
                    "--path": "path('M50 19.2L16 16.6')",
                    "--t": "1500ms",
                  })}
                />
                <circle
                  className="packet"
                  style={artworkStyle({
                    "--path": "path('M50 19.2L84 16.6')",
                    "--t": "1700ms",
                  })}
                />
                <circle
                  className="packet"
                  style={artworkStyle({
                    "--path": "path('M50 19.2L72 46')",
                    "--t": "1900ms",
                  })}
                />
                <circle
                  className="packet"
                  style={artworkStyle({
                    "--path": "path('M72 46L28 46')",
                    "--t": "2200ms",
                  })}
                />
                <circle
                  className="packet"
                  style={artworkStyle({
                    "--path": "path('M28 46L50 19.2')",
                    "--t": "2500ms",
                  })}
                />
              </g>
            </svg>
            <div
              className="node node-api"
              style={artworkStyle({ "--x": "50%", "--y": "30%" })}
            >
              <div
                className="node-box a-pop"
                style={artworkStyle({ "--t": "0ms" })}
              >
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--accent)" })}
                >
                  <Braces className="ico" />
                </i>
                <span>API</span>
              </div>
            </div>
            <div
              className="node"
              style={artworkStyle({ "--x": "16%", "--y": "26%" })}
            >
              <div
                className="node-box a-pop"
                style={artworkStyle({ "--t": "200ms" })}
              >
                <i className="well">
                  <AppWindow className="ico" />
                </i>
                <span>Интерфейс</span>
              </div>
            </div>
            <div
              className="node"
              style={artworkStyle({ "--x": "84%", "--y": "26%" })}
            >
              <div
                className="node-box a-pop"
                style={artworkStyle({ "--t": "350ms" })}
              >
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--amber)" })}
                >
                  <Database className="ico" />
                </i>
                <span>База данных</span>
              </div>
            </div>
            <div
              className="node"
              style={artworkStyle({ "--x": "72%", "--y": "72%" })}
            >
              <div
                className="node-box a-pop"
                style={artworkStyle({ "--t": "500ms" })}
              >
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--mint)" })}
                >
                  <List className="ico" />
                </i>
                <span>Очередь</span>
              </div>
            </div>
            <div
              className="node"
              style={artworkStyle({ "--x": "28%", "--y": "72%" })}
            >
              <div
                className="node-box node-ai a-pop"
                style={artworkStyle({ "--t": "650ms" })}
              >
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--lavender)" })}
                >
                  <Sparkles className="ico" />
                </i>
                <span>AI-модель</span>
              </div>
            </div>
          </div>
        </section>

        <section className="scene scene-4">
          <div className="review">
            <div
              className="checks panel a-up"
              style={artworkStyle({ "--t": "0ms" })}
            >
              <div className="check">
                <span
                  className="status"
                  style={artworkStyle({ "--t": "400ms", "--done": "2500ms" })}
                >
                  <i className="spin"></i>
                  <i className="ok">
                    <Check className="ico" />
                  </i>
                </span>
                Тесты
              </div>
              <div className="check">
                <span
                  className="status"
                  style={artworkStyle({ "--t": "500ms", "--done": "2550ms" })}
                >
                  <i className="spin"></i>
                  <i className="ok">
                    <Check className="ico" />
                  </i>
                </span>
                Сборка
              </div>
              <div className="check">
                <span
                  className="status"
                  style={artworkStyle({ "--t": "600ms", "--done": "2650ms" })}
                >
                  <i className="spin"></i>
                  <i className="ok">
                    <Check className="ico" />
                  </i>
                </span>
                Ревью
              </div>
            </div>
            <div
              className="diff panel a-up"
              style={artworkStyle({ "--t": "120ms" })}
            >
              <div
                className="line a-fade"
                style={artworkStyle({ "--t": "450ms" })}
              >
                <b>function</b>
                {" notify(user) {"}
              </div>
              <div
                className="line del"
                style={artworkStyle({
                  "--t": "520ms",
                  "--t2": "1300ms",
                  "--t3": "2000ms",
                })}
              >
                - send(user)
                <span className="mark-wrap">
                  <span
                    className="mark mark-bug a-pop"
                    style={artworkStyle({ "--t": "1350ms" })}
                  >
                    <X className="ico" />
                    ошибка
                  </span>
                </span>
              </div>
              <div
                className="line add a-fade"
                style={artworkStyle({ "--t": "2000ms" })}
              >
                + if (!user) return ok
                <span className="mark-wrap">
                  <span
                    className="mark mark-fix a-pop"
                    style={artworkStyle({ "--t": "2250ms" })}
                  >
                    <Check className="ico" />
                    исправлено
                  </span>
                </span>
              </div>
              <div
                className="line add a-fade"
                style={artworkStyle({ "--t": "2000ms" })}
              >
                + send(user)
              </div>
              <div
                className="line a-fade"
                style={artworkStyle({ "--t": "660ms" })}
              >
                {" "}
                return ok
              </div>
              <div
                className="line a-fade"
                style={artworkStyle({ "--t": "730ms" })}
              >
                {"}"}
              </div>
              <div
                className="line a-fade"
                style={artworkStyle({ "--t": "870ms" })}
              >
                <b>test</b>(<i>"notify skips empty user"</i>
                {", () => {"}
              </div>
              <div
                className="line a-fade"
                style={artworkStyle({ "--t": "940ms" })}
              >
                {" "}
                expect(notify(null)).toBe(ok)
              </div>
              <div
                className="line a-fade"
                style={artworkStyle({ "--t": "1010ms" })}
              >
                {"})"}
              </div>
            </div>
          </div>
          <div
            className="accept a-pop"
            style={artworkStyle({ "--t": "2900ms" })}
          >
            <UserCheck className="ico" />
            Принято
          </div>
        </section>

        <section className="scene scene-5">
          <div className="pipeline">
            <div
              className="step step-build panel a-up"
              style={artworkStyle({ "--t": "0ms" })}
            >
              <header>
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--accent)" })}
                >
                  <Package className="ico" />
                </i>
                Сборка
              </header>
              <div className="bar">
                <i style={artworkStyle({ "--t": "400ms", "--dur": ".7s" })}></i>
              </div>
            </div>
            <svg className="arrow" viewBox="0 0 24 16">
              <path
                className="draw"
                pathLength="1"
                d="M2 8h18M15 3l5 5-5 5"
                style={artworkStyle({ "--t": "1150ms", "--dur": ".35s" })}
              />
            </svg>
            <div
              className="step-tag a-pop"
              style={artworkStyle({ "--t": "1250ms" })}
            >
              v1.2.0
            </div>
            <svg className="arrow" viewBox="0 0 24 16">
              <path
                className="draw"
                pathLength="1"
                d="M2 8h18M15 3l5 5-5 5"
                style={artworkStyle({ "--t": "1400ms", "--dur": ".35s" })}
              />
            </svg>
            <div
              className="step panel a-up"
              style={artworkStyle({ "--t": "1500ms" })}
            >
              <header>
                <i
                  className="well"
                  style={artworkStyle({ "--c": "var(--mint)" })}
                >
                  <Server className="ico" />
                </i>
                Production
                <i
                  className="live"
                  style={artworkStyle({ "--t": "2500ms" })}
                ></i>
              </header>
              <div
                className="bar"
                style={artworkStyle({ "--bar": "var(--mint)" })}
              >
                <i
                  style={artworkStyle({ "--t": "1700ms", "--dur": ".75s" })}
                ></i>
              </div>
            </div>
          </div>
          <div className="ops">
            <div
              className="metrics panel a-up"
              style={artworkStyle({ "--t": "2000ms" })}
            >
              <span className="label">
                <Activity className="ico" />
                Метрики
              </span>
              <svg viewBox="0 0 100 30" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#4f8cff" stopOpacity=".45" />
                    <stop offset="1" stopColor="#4f8cff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  className="area"
                  d="M0 23C10 21 15 13 25 15S40 25 50 17 65 6 75 10 90 19 100 8V30H0z"
                  style={artworkStyle({
                    fill: `url(#${gradientId})`,
                    "--t": "2700ms",
                  })}
                />
                <path
                  className="curve draw"
                  pathLength="1"
                  d="M0 23C10 21 15 13 25 15S40 25 50 17 65 6 75 10 90 19 100 8"
                  style={artworkStyle({ "--t": "2200ms", "--dur": "1s" })}
                />
              </svg>
            </div>
            <div
              className="logs panel a-up"
              style={artworkStyle({ "--t": "250ms" })}
            >
              <span className="label">
                <ScrollText className="ico" />
                Логи
              </span>
              <div>
                <div
                  className="log a-fade"
                  style={artworkStyle({ "--t": "800ms" })}
                >
                  <b>ok</b> tests 48 passed
                </div>
                <div
                  className="log a-fade"
                  style={artworkStyle({ "--t": "1150ms" })}
                >
                  <b>ok</b> build v1.2.0
                </div>
                <div
                  className="log a-fade"
                  style={artworkStyle({ "--t": "2500ms" })}
                >
                  <b>ok</b> deploy v1.2.0
                </div>
                <div
                  className="log a-fade"
                  style={artworkStyle({ "--t": "2700ms" })}
                >
                  <b>ok</b> health 200
                </div>
                <div
                  className="log a-fade"
                  style={artworkStyle({ "--t": "2900ms" })}
                >
                  <span className="warn">warn</span> queue lag 1.2s
                </div>
                <div
                  className="log a-fade"
                  style={artworkStyle({ "--t": "3100ms" })}
                >
                  <b>ok</b> retry · lag 0.1s
                </div>
              </div>
            </div>
          </div>
          <div
            className="next a-left"
            style={artworkStyle({ "--t": "3100ms" })}
          >
            <GitBranch className="ico" />
            <code>v1.3</code> следующее обновление
          </div>
        </section>
      </div>
    </div>
  );
}
