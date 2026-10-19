import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";

import { ProductLandingView } from "@/_pages/library-discovery/ui/product-landing-view";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { Button } from "@/shared/ui/button";
import {
  aiEngineeringCourseChapters,
  aiEngineeringCoursePage,
} from "@/storybook/ai-engineering-course.fixtures";
import {
  renderTelegramSignInContent,
  telegramSignInStyles,
} from "../../../../../infra/identity/logto/fork/packages/core/src/routes/inside-telegram-view";

import "./waitlist-proof.css";

// PROTOTYPE #1568: one incumbent course composition; fixture state only, no requests or persistence.
export type WaitlistState =
  | "guest"
  | "linked"
  | "account-without-telegram"
  | "linking"
  | "saving"
  | "success"
  | "error"
  | "enrolled";
const labels: Record<WaitlistState, string> = {
  guest: "Гость",
  linked: "Telegram связан",
  "account-without-telegram": "Account без Telegram",
  linking: "Подтверждение в Telegram",
  saving: "Сохранение",
  success: "Вы в списке",
  error: "Ошибка сохранения",
  enrolled: "Действующий ученик",
};
const result = {
  kind: "empty" as const,
  discoveryKind: "series" as const,
  chapters: aiEngineeringCourseChapters,
  relatedSeries: [],
  topics: [],
  reference: {
    name: "AI Engineering",
    slug: "ai-engineering",
    summary: "",
    productPage: {
      presentation: "ai-engineering-course" as const,
      page: aiEngineeringCoursePage,
    },
  },
};

export function WaitlistProof({
  initialState = "guest",
  freezeSaving = false,
}: {
  readonly initialState?: WaitlistState;
  readonly freezeSaving?: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [failNext, setFailNext] = useState(false);
  const [linkAccount, setLinkAccount] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (state !== "saving" || freezeSaving) return;
    const timer = window.setTimeout(() => {
      setState(failNext ? "error" : "success");
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state, failNext, freezeSaving]);
  function begin() {
    setNotice("");
    if (state === "guest" || state === "account-without-telegram") {
      setLinkAccount(state === "account-without-telegram");
      setState("linking");
    } else setState("saving");
  }
  function cancelLink(expired: boolean) {
    setState(linkAccount ? "account-without-telegram" : "guest");
    setNotice(
      expired
        ? "Время подтверждения истекло. Вы ещё не в списке. Попробуйте снова."
        : "Вход отменён. Вы ещё не в списке.",
    );
  }
  function withdraw() {
    setState("linked");
    setNotice("Вы отказались от ожидания. Можно записаться снова.");
  }
  const action = (lower: boolean) => (
    <WaitlistAction
      lower={lower}
      onBegin={begin}
      onWithdraw={withdraw}
      state={state}
    />
  );
  return (
    <>
      <aside
        aria-label="Управление макетом"
        className="waitlist-proof-controls"
      >
        <strong>Макет #1568</strong>
        <label>
          Сценарий{" "}
          <select
            value={state}
            onChange={(event) => {
              const next = (
                [
                  "guest",
                  "linked",
                  "account-without-telegram",
                  "linking",
                  "saving",
                  "success",
                  "error",
                  "enrolled",
                ] satisfies WaitlistState[]
              ).find((value) => value === event.target.value);
              if (next !== undefined) setState(next);
              setNotice("");
            }}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ответ сервера{" "}
          <select
            value={failNext ? "error" : "success"}
            onChange={(event) => {
              setFailNext(event.target.value === "error");
            }}
          >
            <option value="success">Успех</option>
            <option value="error">Ошибка</option>
          </select>
        </label>
        <span>Данные в памяти · Telegram и сервер не вызываются</span>
        {state === "linking" ? (
          <div className="waitlist-proof-simulate">
            <Button
              onClick={() => {
                setState("saving");
              }}
            >
              Подтвердить в примере
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                cancelLink(false);
              }}
            >
              Отменить
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                cancelLink(true);
              }}
            >
              Время истекло
            </Button>
          </div>
        ) : null}
      </aside>
      <p aria-atomic="true" className="waitlist-announcement" role="status">
        {state === "saving"
          ? "Сохраняю запись. Подтверждение появится после сохранения."
          : state === "success"
            ? "Вы в списке. Сообщу об открытии набора в Telegram."
            : notice}
      </p>
      {state === "error" ? (
        <p
          aria-atomic="true"
          className="waitlist-error-announcement"
          role="alert"
        >
          Не удалось сохранить запись. Вы ещё не в списке. Попробуйте снова.
        </p>
      ) : null}
      {state === "linking" ? (
        <section
          className="waitlist-linking"
          aria-label={
            linkAccount
              ? "Привязка Telegram к текущему Account"
              : "Вход через Telegram"
          }
        >
          {linkAccount ? (
            <p className="waitlist-link-context">
              Подключите Telegram к текущему аккаунту, чтобы получить
              уведомление. Учебный доступ сохранится.
            </p>
          ) : null}
          <style>{telegramSignInStyles}</style>
          <div className="inside-telegram" lang="ru">
            <div
              dangerouslySetInnerHTML={{
                __html: renderTelegramSignInContent({
                  status: "pending",
                  deepLink: "#telegram-proof",
                }),
              }}
              onClick={(event) => {
                event.preventDefault();
              }}
            />
          </div>
        </section>
      ) : (
        <ProductLandingView
          result={result}
          returnTarget={homeMaterialReaderReturnTarget}
          heroCall={action(false)}
          statusCall={
            <div className="waitlist-lower">
              <h2>
                {state === "success"
                  ? "Вы в списке"
                  : state === "enrolled"
                    ? "Ваш курс"
                    : "Следующий поток"}
              </h2>
              <p>
                {state === "success"
                  ? "Сообщу об открытии набора в Telegram."
                  : state === "enrolled"
                    ? "Откройте программу или продолжите обучение."
                    : "Оставьте заявку — сообщу в Telegram, когда откроется набор."}
              </p>
              {action(true)}
            </div>
          }
        />
      )}
    </>
  );
}

function WaitlistAction({
  state,
  lower,
  onBegin,
  onWithdraw,
}: {
  readonly state: WaitlistState;
  readonly lower: boolean;
  readonly onBegin: () => void;
  readonly onWithdraw: () => void;
}) {
  if (state === "enrolled")
    return (
      <div className="waitlist-action">
        <Link
          className={lower ? "aie-status-button" : "aie-hero-action"}
          href="/products/ai-engineering/programme"
        >
          Продолжить обучение <ArrowRight aria-hidden="true" />
        </Link>
        <Link
          className="waitlist-secondary"
          href="/products/ai-engineering/programme"
        >
          Открыть программу
        </Link>
      </div>
    );
  const saved = state === "success";
  return (
    <div
      className={`waitlist-action ${lower ? "waitlist-action-lower" : ""}`}
      aria-busy={state === "saving"}
    >
      {saved ? (
        lower ? null : (
          <div className="waitlist-confirmed">
            <span>
              <Check aria-hidden="true" /> Вы в списке
            </span>
            <p>Сообщу об открытии набора в Telegram.</p>
          </div>
        )
      ) : (
        <>
          {lower ? null : (
            <p className="waitlist-invitation">
              Набор будет ограничен. Узнайте об открытии первыми — в Telegram.
            </p>
          )}
          <button
            className={lower ? "aie-status-button" : "aie-hero-action"}
            disabled={state === "saving"}
            onClick={onBegin}
            type="button"
          >
            {state === "saving" ? (
              <>
                Сохраняю… <LoaderCircle aria-hidden="true" />
              </>
            ) : (
              <>
                Жду набор <ArrowRight aria-hidden="true" />
              </>
            )}
          </button>
          {state === "error" ? (
            <p className="waitlist-inline-error">
              Не удалось сохранить запись. Вы ещё не в списке. Попробуйте снова.
            </p>
          ) : null}
        </>
      )}
      <div className="waitlist-secondary-actions">
        <Link
          className="waitlist-secondary"
          href="/products/ai-engineering/programme"
        >
          Программа и бесплатные материалы <ArrowRight aria-hidden="true" />
        </Link>
        {saved ? (
          <button
            className="waitlist-secondary waitlist-withdraw"
            type="button"
            onClick={onWithdraw}
          >
            Отказаться от ожидания
          </button>
        ) : null}
      </div>
    </div>
  );
}
