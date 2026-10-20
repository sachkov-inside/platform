import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import "./waitlist-action.css";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
export type WaitlistState =
  "idle" | "loading" | "saving" | "success" | "error" | "linking" | "expired";
export interface WaitlistActionProps {
  readonly state: WaitlistState;
  readonly lower?: boolean;
  readonly onBegin: () => void;
  readonly onWithdraw: () => void;
  readonly linking?: ReactNode;
  readonly notice?: string;
  readonly retryingWithdrawal?: boolean;
}
/** Existing intent or membership management never offers a new signup beside purchase or learning. */
export function WaitlistMembership({
  state,
  notice = "",
  onBegin,
  onWithdraw,
  linking,
  retryingWithdrawal = false,
}: Omit<WaitlistActionProps, "lower">) {
  if (state === "idle" && notice === "") return null;
  return (
    <div className="waitlist-membership">
      {state === "success" ? (
        <WaitlistAction
          state={state}
          onBegin={onBegin}
          onWithdraw={onWithdraw}
        />
      ) : state === "loading" || state === "saving" ? (
        <p role="status">
          {state === "loading" ? "Проверяю запись…" : "Сохраняю…"}
        </p>
      ) : state === "error" ? (
        <>
          <p role="alert">Не удалось обновить запись в список ожидания.</p>
          <button
            className="waitlist-secondary waitlist-withdraw"
            type="button"
            onClick={onBegin}
          >
            {retryingWithdrawal ? "Повторить отказ" : "Повторить"}
          </button>
        </>
      ) : state === "linking" ? (
        <>
          <p>
            Подключите Telegram к текущему аккаунту, чтобы завершить запись.
          </p>
          {linking}
        </>
      ) : (
        <p role="status">
          {state === "expired"
            ? "Срок заявки истёк. Запись не завершена."
            : "Вы отказались от ожидания."}
        </p>
      )}
    </div>
  );
}
/** The accepted #1568 presentation. Both course slots consume one confirmed membership state. */
export function WaitlistAction({
  state,
  lower = false,
  onBegin,
  linking,
  notice = "",
}: WaitlistActionProps) {
  const saved = state === "success";
  const busy = state === "saving" || state === "loading";
  const label = saved
    ? "Вы в списке ожидания"
    : busy
      ? state === "loading"
        ? "Проверяю запись…"
        : "Сохраняю…"
      : "Вступить в список ожидания";
  const action = (
    <div
      className={`waitlist-action ${lower ? "waitlist-action-lower" : ""}`}
      aria-busy={busy}
    >
      {state === "linking" ? (
        <div className="waitlist-link-context">
          <p>
            Подключите Telegram к текущему аккаунту, чтобы завершить запись.
          </p>
          {linking}
        </div>
      ) : (
        <button
          className={
            lower
              ? "aie-cohort-ticket-buy waitlist-ticket-button"
              : "aie-cohort-live waitlist-hero-pill"
          }
          disabled={busy || saved}
          onClick={onBegin}
          type="button"
        >
          {lower ? null : saved ? (
            <Check aria-hidden="true" />
          ) : (
            <span className="aie-cohort-live-dot" aria-hidden="true" />
          )}
          <span className="aie-cohort-live-text">{label}</span>
          {busy ? (
            <LoaderCircle aria-hidden="true" />
          ) : saved ? null : (
            <ArrowRight aria-hidden="true" />
          )}
        </button>
      )}
      {state === "error" ? (
        <p className="waitlist-inline-error" role="alert">
          Не удалось проверить или сохранить запись. Попробуйте снова.
        </p>
      ) : null}
      {state === "expired" ? (
        <p className="waitlist-inline-error" role="alert">
          Время подтверждения истекло. Вы ещё не в списке. Попробуйте снова.
        </p>
      ) : null}
      <p className="sr-only" role="status" aria-atomic="true">
        {busy || saved ? label : notice}
      </p>
    </div>
  );
  return lower ? (
    <div className="aie-cohort-status">
      <div className="aie-cohort-status-intro">
        <h2>Набор на первый поток</h2>
        <p>Предзаказ скоро начнётся.</p>
      </div>
      <div className="aie-cohort-ticket-wrap">
        <div className="aie-cohort-ticket">
          <div className="aie-cohort-ticket-head">
            <span>Предзаказ</span>
          </div>
          <p className="aie-cohort-ticket-soon">Скоро начнётся</p>
          <div className="aie-cohort-ticket-tear" aria-hidden="true" />
          <div className="aie-cohort-ticket-actions">
            {action}
            <IntentPrefetchLink
              className="aie-cohort-ticket-programme"
              href={productProgrammeHref("ai-engineering")}
            >
              Открыть программу
            </IntentPrefetchLink>
          </div>
        </div>
      </div>
    </div>
  ) : (
    action
  );
}
