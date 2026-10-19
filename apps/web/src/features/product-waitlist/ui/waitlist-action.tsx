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
  onWithdraw,
  linking,
  notice = "",
  retryingWithdrawal = false,
}: WaitlistActionProps) {
  const saved = state === "success";
  const busy = state === "saving" || state === "loading";
  const action = (
    <div
      className={`waitlist-action ${lower ? "waitlist-action-lower" : ""}`}
      aria-busy={busy}
    >
      {saved ? (
        lower ? null : (
          <div className="waitlist-confirmed">
            <span>
              <Check aria-hidden="true" />
              Вы в списке
            </span>
            <p>Сообщу об открытии набора в Telegram.</p>
          </div>
        )
      ) : state === "linking" ? (
        <div className="waitlist-link-context">
          <p>
            Подключите Telegram к текущему аккаунту, чтобы завершить запись.
          </p>
          {linking}
        </div>
      ) : (
        <button
          className={lower ? "aie-status-button" : "aie-hero-action"}
          disabled={busy}
          onClick={onBegin}
          type="button"
        >
          {busy ? (
            <>
              {state === "loading" ? "Проверяю запись…" : "Сохраняю…"}
              <LoaderCircle aria-hidden="true" />
            </>
          ) : (
            <>
              {retryingWithdrawal
                ? "Повторить отказ"
                : "Вступить в список ожидания"}
              <ArrowRight aria-hidden="true" />
            </>
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
      {lower || saved ? (
        <div className="waitlist-secondary-actions">
          {lower ? (
            <IntentPrefetchLink
              className="waitlist-secondary"
              href={productProgrammeHref("ai-engineering")}
            >
              Программа и бесплатные материалы
              <ArrowRight aria-hidden="true" />
            </IntentPrefetchLink>
          ) : null}
          {saved ? (
            <button
              className="waitlist-secondary waitlist-withdraw"
              onClick={onWithdraw}
              type="button"
            >
              Отказаться от ожидания
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-atomic="true">
        {busy
          ? "Проверяю и сохраняю запись."
          : saved
            ? "Вы в списке. Сообщу об открытии набора в Telegram."
            : notice}
      </p>
    </div>
  );
  return lower ? (
    <div className="waitlist-lower">
      <h2>{saved ? "Вы в списке" : "Следующий поток"}</h2>
      <p>
        {saved
          ? "Сообщу об открытии набора в Telegram."
          : "Оставьте заявку. Сообщу в Telegram, когда откроется набор."}
      </p>
      {action}
    </div>
  ) : (
    action
  );
}
