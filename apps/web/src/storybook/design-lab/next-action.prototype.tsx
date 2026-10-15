import { useState } from "react";
import { ArrowRight, Check, Circle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { DemoControls } from "./demo-controls.prototype";

const authorSteps = ["Описание", "Программа", "Preview"];
const learnerSteps = [
  "Привязать Telegram",
  "Вступить в сообщество",
  "Начать первый урок",
];
export function NextAction({ variant }: { readonly variant: number }) {
  const [role, setRole] = useState("author");
  const [community, setCommunity] = useState(true);
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState("Онбординг");
  const [authorTab, setAuthorTab] = useState(0);
  const [description, setDescription] = useState(
    "Соберите приложение с агентом и доведите его до первого релиза.",
  );
  const [saved, setSaved] = useState(description);
  const [lesson, setLesson] = useState(false);
  const [joinState, setJoinState] = useState("idle");
  const incomplete = community && step < 3;
  const activeTab = incomplete ? tab : tab === "Онбординг" ? "Программа" : tab;
  function setLearnerState(value: string) {
    setStep(Number(value));
    setTab(Number(value) < 3 ? "Онбординг" : "Программа");
    setLesson(false);
    setJoinState("idle");
  }
  return (
    <>
      <DemoControls>
        <label>
          Кто работает
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
            }}
          >
            <option value="author">Автор</option>
            <option value="learner">Ученик</option>
          </select>
        </label>
        {role === "learner" ? (
          <>
            <label className="lab-checkbox">
              <input
                type="checkbox"
                checked={community}
                onChange={(e) => {
                  setCommunity(e.target.checked);
                  setLesson(false);
                }}
              />
              В продукт входит сообщество
            </label>
            <label>
              Онбординг
              <select
                value={step}
                onChange={(e) => {
                  setLearnerState(e.target.value);
                }}
              >
                <option value="0">Telegram не привязан</option>
                <option value="1">Telegram уже привязан</option>
                <option value="2">Участие подтверждено</option>
                <option value="3">Завершён</option>
              </select>
            </label>
          </>
        ) : (
          <label>
            Подготовка
            <select
              value={step}
              onChange={(e) => {
                setStep(Number(e.target.value));
                setAuthorTab(Math.min(Number(e.target.value), 2));
              }}
            >
              <option value="0">Описание не готово</option>
              <option value="1">Описание готово</option>
              <option value="2">Программа готова</option>
              <option value="3">Preview просмотрен</option>
            </select>
          </label>
        )}
      </DemoControls>
      <div className="lab-task-surface">
        <header className="lab-task-header">
          <div>
            <h2>Создание Platform Inside</h2>
            <p>
              {role === "author"
                ? "Подготовка продукта · автор"
                : "Ваш продукт · ученик"}
            </p>
          </div>
          <span className="lab-tag">
            {role === "author" ? "Черновик" : "Доступ открыт"}
          </span>
        </header>
        {role === "author" ? (
          <>
            <nav className="lab-task-tabs" aria-label="Подготовка продукта">
              {authorSteps.map((name, i) => (
                <button
                  type="button"
                  key={name}
                  aria-current={authorTab === i ? "page" : undefined}
                  onClick={() => {
                    setAuthorTab(i);
                  }}
                >
                  {variant === 1 && step > i ? (
                    <Check aria-hidden="true" size={16} />
                  ) : null}
                  {name}
                </button>
              ))}
            </nav>
            {variant === 1 ? (
              <div className="lab-next-callout">
                <div>
                  <strong>
                    {step >= 3
                      ? "Продукт готов к проверке владельцем"
                      : `Следующее действие: ${["дополнить описание", "собрать программу", "открыть Preview"][step] ?? ""}`}
                  </strong>
                  <p>
                    {step >= 3
                      ? "Публикация остаётся отдельным явным действием владельца."
                      : "Черновик сохраняется при переходе между разделами."}
                  </p>
                </div>
                {step < 3 ? (
                  <Button
                    onClick={() => {
                      setAuthorTab(Math.min(step, 2));
                    }}
                  >
                    Перейти
                    <ArrowRight aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ) : null}
            {authorTab === 0 ? (
              <section className="lab-editor-section">
                <h3>Описание продукта</h3>
                <label className="lab-field">
                  Какой результат получит ученик
                  <textarea
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                    }}
                  />
                </label>
                <div className="lab-actions">
                  <Button
                    onClick={() => {
                      setSaved(description);
                      setStep(Math.max(step, 1));
                      if (variant === 1) setAuthorTab(1);
                    }}
                  >
                    Сохранить описание{variant === 1 ? " и продолжить" : ""}
                  </Button>
                  <span role="status">
                    {description === saved
                      ? "Описание сохранено в примере"
                      : "Есть несохранённые изменения"}
                  </span>
                </div>
              </section>
            ) : authorTab === 1 ? (
              <section className="lab-editor-section">
                <h3>Программа</h3>
                <div className="lab-data-row">
                  1. Контекст задачи и границы системы
                </div>
                <div className="lab-data-row">2. Первый вертикальный срез</div>
                <Button
                  onClick={() => {
                    setStep(Math.max(step, 2));
                    if (variant === 1) setAuthorTab(2);
                  }}
                >
                  Подтвердить программу
                </Button>
              </section>
            ) : (
              <section className="lab-editor-section">
                <h3>Preview сохранённого описания</h3>
                <p>{saved}</p>
                {saved !== description ? (
                  <p className="lab-notice">
                    Последние изменения ещё не сохранены. Preview показывает
                    сохранённое описание.
                  </p>
                ) : null}
                <Button
                  onClick={() => {
                    setStep(3);
                  }}
                >
                  Проверка завершена
                </Button>
                <p className="lab-muted">Preview не публикует продукт.</p>
              </section>
            )}
          </>
        ) : (
          <>
            <nav className="lab-task-tabs" aria-label="Разделы обучения">
              {[
                ...(incomplete ? ["Онбординг"] : []),
                "Программа",
                "Материалы",
                "Артефакты",
              ].map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-current={activeTab === name ? "page" : undefined}
                  onClick={() => {
                    setTab(name);
                    setLesson(false);
                  }}
                >
                  {name}
                </button>
              ))}
            </nav>
            {incomplete && activeTab === "Онбординг" ? (
              <section className="lab-editor-section">
                <h3>Начните обучение</h3>
                {variant === 1 ? (
                  <div className="lab-next-callout">
                    <div>
                      <strong>Сейчас: {learnerSteps[step]}</strong>
                      <p>
                        {
                          [
                            "Подключите свой аккаунт Telegram.",
                            "Telegram подключён. Осталось вступить в сообщество продукта.",
                            "Участие подтверждено. Можно открыть первый урок.",
                          ][step]
                        }
                      </p>
                    </div>
                  </div>
                ) : null}
                <ol className="lab-steps">
                  {learnerSteps.map((name, index) => (
                    <li
                      key={name}
                      aria-current={index === step ? "step" : undefined}
                    >
                      <span>
                        {step > index ? (
                          <Check aria-hidden="true" size={18} />
                        ) : (
                          <Circle aria-hidden="true" size={18} />
                        )}
                      </span>
                      <div>
                        <strong>{name}</strong>
                        <p>
                          {step > index
                            ? "Готово"
                            : index === step
                              ? "Текущий шаг"
                              : "Далее"}
                        </p>
                      </div>
                      {index === step && joinState !== "pending" ? (
                        <Button
                          onClick={() => {
                            if (step === 1) setJoinState("pending");
                            else if (step === 2) {
                              setStep(3);
                              setTab("Программа");
                              setLesson(true);
                            } else setStep(step + 1);
                          }}
                        >
                          {
                            [
                              "Привязать Telegram",
                              "Подать заявку",
                              "Открыть первый урок",
                            ][step]
                          }
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {joinState === "pending" && step === 1 ? (
                  <div className="lab-notice">
                    <p role="status">
                      Заявка отправлена. Ждём подтверждения участия.
                    </p>
                    <div className="lab-actions">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setStep(2);
                          setJoinState("idle");
                        }}
                      >
                        Имитировать подтверждение
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setJoinState("error");
                        }}
                      >
                        Имитировать ошибку
                      </Button>
                    </div>
                  </div>
                ) : null}
                {joinState === "error" && step === 1 ? (
                  <p role="alert" className="lab-error">
                    Не удалось получить приглашение. Повторите отправку заявки.
                  </p>
                ) : null}
                <p className="lab-muted">
                  Демонстрация: Telegram и сообщество не вызываются.
                </p>
              </section>
            ) : (
              <section className="lab-editor-section">
                <h3>{lesson ? "Первый урок · Контекст задачи" : activeTab}</h3>
                {!community ? (
                  <p className="lab-notice">
                    В этот продукт не входит сообщество. Привязка Telegram не
                    нужна.
                  </p>
                ) : null}
                {lesson ? (
                  <>
                    <p>
                      Начните с задачи человека и определите проверяемый
                      результат.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setLesson(false);
                      }}
                    >
                      К программе
                    </Button>
                  </>
                ) : activeTab === "Программа" || activeTab === "Материалы" ? (
                  <button
                    type="button"
                    className="lab-material-row"
                    onClick={() => {
                      setLesson(true);
                    }}
                  >
                    <span>
                      <strong>Контекст задачи и границы системы</strong>
                      <small>Первый урок · 12 минут</small>
                    </span>
                    <ArrowRight size={20} aria-hidden="true" />
                  </button>
                ) : (
                  <p>Шаблон технического решения · PDF</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
      <p className="lab-source-note">
        {variant === 0
          ? "База автора: существующий вход по разделам. База ученика: композиция PR #1449, ab05b08; адаптация на одинаковые fixtures. Меню завершённого онбординга скрыто по #1443."
          : "Идея: blocks.so onboarding и Astryx Stepper. Один незавершённый шаг с действием; программа остаётся доступной."}
      </p>
    </>
  );
}
