"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";

/** Throwaway proof for #1442, #1443 and #1444. No production adapter or real mutations. */
export const buyerStates = {
  guest: "Гость",
  loading: "Читаем покупку",
  checkout: "Email аккаунта",
  email: "Нет email",
  invalid: "Ошибка email",
  creating: "Создаём платёж",
  hosted: "Платёж сформирован",
  waiting: "Возврат: ждём банк",
  failed: "Оплата не прошла",
  missing: "Покупка не указана",
  preparing: "Оплачено: готовим доступ",
  ready: "Готово без сообщества",
  telegram: "Привязать Telegram",
  invitation: "Telegram уже привязан",
  joining: "Заявка в группу",
  joinError: "Сбой приглашения",
  member: "Уже в группе",
  purchases: "Несколько покупок",
  refunded: "Полный возврат",
  otherGrant: "Возврат: другое основание",
} as const;

export type BuyerState = keyof typeof buyerStates;

const productName = "Создание Platform Inside";
const inputClass =
  "mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const actionClass = "min-h-12 w-full whitespace-normal px-4 text-base";
const communityStates: readonly BuyerState[] = [
  "telegram",
  "invitation",
  "joining",
  "joinError",
  "member",
];

export function BuyerJourneyPrototype({
  initialState = "checkout",
}: {
  readonly initialState?: BuyerState;
}) {
  const [state, setState] = useState(initialState);
  const [email, setEmail] = useState("");
  const [opened, setOpened] = useState(false);
  const community = communityStates.includes(state);
  const paid = state === "preparing" || state === "ready" || community;
  const completion = state === "ready" || community;
  const current =
    state === "guest" ? 0 : completion ? 3 : state === "preparing" ? 2 : 1;
  const needsEmail = state === "email" || state === "invalid";
  const isCheckout = state === "checkout" || needsEmail;
  const history =
    state === "purchases" || state === "refunded" || state === "otherGrant";

  return (
    <div className="mx-auto w-full min-w-0 max-w-[38rem] pb-8">
      <div className="mb-6 rounded-xl bg-secondary p-4 text-sm">
        <p className="font-semibold">Прототип единого пути · #1442–1444</p>
        <p className="mt-1 text-muted-foreground">
          Демонстрационные данные. Кнопки не создают платежи и не отправляют
          приглашения.
        </p>
        <label className="mt-3 block" htmlFor="buyer-demo-state">
          Состояние покупателя
        </label>
        <select
          className={inputClass}
          id="buyer-demo-state"
          value={state}
          onChange={(event) => {
            const next = Object.keys(buyerStates).find(
              (key): key is BuyerState => key === event.target.value,
            );
            if (next !== undefined) {
              setState(next);
              setOpened(false);
            }
          }}
        >
          {Object.entries(buyerStates).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <a
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
        href="#programme"
        onClick={(event) => {
          event.preventDefault();
        }}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Программа
      </a>
      <h1 className="mt-4 break-words text-2xl font-bold tracking-tight md:text-3xl">
        {history ? "Покупки" : productName}
      </h1>
      {history ? (
        <PurchaseHistory
          state={state}
          onContinue={() => {
            setState("ready");
          }}
        />
      ) : (
        <>
          <ol
            aria-label="Шаги покупки"
            className="mt-6 grid grid-cols-4 gap-2 text-xs font-semibold"
          >
            {["Вход", "Оплата", "Доступ", "Начать"].map((label, index) => (
              <li
                key={label}
                aria-current={index === current ? "step" : undefined}
                className={
                  index > current ? "text-muted-foreground" : "text-foreground"
                }
              >
                <span
                  aria-hidden="true"
                  className={`mb-2 block h-1 rounded-full ${index <= current ? "bg-foreground" : "bg-muted"}`}
                />
                <span className="flex items-center gap-1">
                  {index < current ? (
                    <Check aria-hidden="true" className="size-3" />
                  ) : null}
                  {label}
                </span>
              </li>
            ))}
          </ol>
          <section
            className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-7"
            aria-label="Ваша покупка"
          >
            <h2 className="sr-only">Состав покупки</h2>
            <ul className="mt-3 grid gap-1 text-sm leading-6 text-muted-foreground">
              <li>Материалы продукта — без даты окончания</li>
              <li>Сопровождение — 6 месяцев с подтверждения оплаты</li>
              {community ? (
                <li>Сообщество «{productName}» в Telegram</li>
              ) : null}
            </ul>
            <div className="mt-5 flex flex-wrap items-baseline gap-3 border-t border-border pt-5">
              <p className="text-3xl font-bold tabular-nums">100 ₽</p>
              <s className="text-sm text-muted-foreground">
                <span className="sr-only">До скидки: </span>200 ₽
              </s>
              <span className="text-sm font-semibold">Скидка 50%</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {paid ? "Оплачено разово" : "Разовая оплата"}
            </p>
            <div
              className="mt-6 border-t border-border pt-6"
              aria-live="polite"
            >
              {state === "guest" ? (
                <>
                  <h3 className="text-lg font-semibold">
                    Войдите, чтобы сохранить покупку
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    После входа вы вернётесь сюда, к этому продукту и цене.
                  </p>
                  <Button
                    className={`${actionClass} mt-5`}
                    onClick={() => {
                      setState("checkout");
                    }}
                  >
                    Войти и продолжить
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </>
              ) : null}
              {isCheckout ? (
                <form
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    const field =
                      event.currentTarget.elements.namedItem("receipt-email");
                    if (
                      needsEmail &&
                      (!(field instanceof HTMLInputElement) ||
                        !field.validity.valid)
                    ) {
                      setState("invalid");
                      return;
                    }
                    setState("creating");
                  }}
                >
                  <h3 className="text-lg font-semibold">Оплата продукта</h3>
                  {needsEmail ? (
                    <div className="mt-4">
                      <label
                        htmlFor="receipt-email"
                        className="text-sm font-semibold"
                      >
                        Email для чека
                      </label>
                      <input
                        className={inputClass}
                        id="receipt-email"
                        name="receipt-email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        type="email"
                        required
                        value={email}
                        aria-invalid={state === "invalid"}
                        aria-describedby={
                          state === "invalid" ? "email-error" : "email-help"
                        }
                        onChange={(event) => {
                          setEmail(event.target.value);
                        }}
                      />
                      {state === "invalid" ? (
                        <p
                          id="email-error"
                          role="alert"
                          className="mt-2 text-sm text-destructive"
                        >
                          Укажите корректный email, например reader@example.com.
                        </p>
                      ) : (
                        <p
                          id="email-help"
                          className="mt-2 text-sm text-muted-foreground"
                        >
                          В вашем аккаунте пока нет email.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6">
                      Чек и сообщения о покупке:{" "}
                      <strong>reader@example.com</strong>
                      <span className="block text-muted-foreground">
                        Используем email вашего аккаунта.
                      </span>
                    </p>
                  )}
                  <details className="mt-5 text-sm leading-6">
                    <summary className="cursor-pointer font-semibold">
                      Условия и документы покупки
                    </summary>
                    <p className="mt-2 text-muted-foreground">
                      Материалы без даты окончания. Сопровождение 6 месяцев.
                      Условия и сроки фиксируются при покупке.
                    </p>
                    <p className="mt-2">
                      Оферта покупки · Правила платформы · Политика
                      конфиденциальности
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      Это образец блока. Production покажет ссылки на применимые
                      редакции документов.
                    </p>
                  </details>
                  <Button className={`${actionClass} mt-5`} type="submit">
                    Оплатить 100 ₽
                  </Button>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Нажимая «Оплатить», вы принимаете применимые условия
                    покупки. Оплата откроется на странице банка.
                  </p>
                </form>
              ) : null}
              {state === "loading" ? (
                <Status
                  title="Восстанавливаем вашу покупку"
                  text="Проверяем сохранённое состояние на сервере."
                  busy
                />
              ) : null}
              {state === "creating" ? (
                <>
                  <Status
                    title="Готовим страницу банка"
                    text="Сохраняем покупку. Повторное открытие продолжит этот платёж."
                    busy
                  />
                  <DemoEvent
                    onClick={() => {
                      setState("hosted");
                    }}
                  >
                    Платёж сформирован
                  </DemoEvent>
                </>
              ) : null}
              {state === "hosted" ? (
                <>
                  <Status
                    title="Оплата ожидается"
                    text="Платёж уже сформирован. Продолжите его на странице банка."
                  />
                  <Button
                    className={`${actionClass} mt-5`}
                    onClick={() => {
                      setState("waiting");
                    }}
                  >
                    Открыть страницу оплаты
                  </Button>
                </>
              ) : null}
              {state === "waiting" ? (
                <>
                  <Status
                    title="Проверяем оплату"
                    text="Вы вернулись из банка. Ждём подтверждения оплаты от банка."
                    busy
                  />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Статус обновляется автоматически. Повторно платить не нужно.
                  </p>
                  <DemoEvent
                    onClick={() => {
                      setState("preparing");
                    }}
                  >
                    Банк подтвердил оплату
                  </DemoEvent>
                </>
              ) : null}
              {state === "failed" ? (
                <>
                  <Status
                    title="Оплата не прошла"
                    text="Банк не подтвердил оплату. Доступ по этой покупке ещё не открыт."
                  />
                  <Button
                    className={`${actionClass} mt-5`}
                    onClick={() => {
                      setState("hosted");
                    }}
                  >
                    Продолжить оплату
                  </Button>
                </>
              ) : null}
              {state === "missing" ? (
                <>
                  <Status
                    title="Не удалось определить покупку"
                    text="Выберите покупку в кабинете. Мы не будем подставлять другой платёж."
                  />
                  <Button
                    className={`${actionClass} mt-5`}
                    onClick={() => {
                      setState("purchases");
                    }}
                  >
                    Открыть покупки
                  </Button>
                </>
              ) : null}
              {state === "preparing" ? (
                <>
                  <Status
                    title="Оплата подтверждена. Открываем доступ"
                    text="Здесь появится следующий шаг, как только доступ будет готов."
                    busy
                  />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Чек формируется. Он придёт на reader@example.com.
                  </p>
                  <DemoEvent
                    onClick={() => {
                      setState("ready");
                    }}
                  >
                    Доступ подготовлен
                  </DemoEvent>
                </>
              ) : null}
              {completion ? (
                <>
                  <Status
                    title="Продукт доступен"
                    text="Оплата подтверждена. Можно начать обучение."
                  />
                  {community ? (
                    <CommunityStep state={state} onState={setState} />
                  ) : null}
                  <Button
                    className={`${actionClass} mt-5`}
                    onClick={() => {
                      setOpened(true);
                    }}
                  >
                    Открыть «{productName}»<ArrowRight aria-hidden="true" />
                  </Button>
                  {opened ? (
                    <p className="mt-3 text-sm" role="status">
                      В приложении откроется программа приобретённого продукта.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
            {paid ? (
              <details className="mt-5 border-t border-border pt-4 text-sm leading-6">
                <summary className="cursor-pointer">Покупка и чек</summary>
                <p className="mt-2">Покупка № DEMO-1442 · 14 октября 2026</p>
                <p>
                  Оплачено 100 ₽. Чек:{" "}
                  {state === "preparing" ? "формируется" : "отправлен"}.
                </p>
              </details>
            ) : null}
          </section>
          <Button
            className="mt-4 min-h-11"
            variant="ghost"
            onClick={() => {
              setState("purchases");
            }}
          >
            Все мои покупки
          </Button>
        </>
      )}
    </div>
  );
}

function Status({
  title,
  text,
  busy = false,
}: {
  readonly title: string;
  readonly text: string;
  readonly busy?: boolean;
}) {
  return (
    <div role="status">
      <h3 className="flex items-start gap-2 text-lg font-semibold">
        {busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="mt-1 size-5 shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function DemoEvent({
  children,
  onClick,
}: {
  readonly children: string;
  readonly onClick: () => void;
}) {
  return (
    <Button className="mt-4 min-h-11" variant="outline" onClick={onClick}>
      Демо: {children}
    </Button>
  );
}

function CommunityStep({
  state,
  onState,
}: {
  readonly state: BuyerState;
  readonly onState: (state: BuyerState) => void;
}) {
  return (
    <section
      className="mt-5 border-t border-border pt-5"
      aria-label="Сообщество продукта"
    >
      <h4 className="font-semibold">Сообщество «{productName}»</h4>
      {state === "telegram" ? (
        <>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Привяжите Telegram, чтобы вступить в группу этого продукта.
          </p>
          <Button
            className="mt-4 min-h-11 w-full"
            variant="outline"
            onClick={() => {
              onState("invitation");
            }}
          >
            Привязать Telegram
          </Button>
        </>
      ) : null}
      {state === "invitation" ? (
        <>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Telegram @demo_reader уже привязан.
          </p>
          <Button
            className="mt-4 min-h-11 w-full"
            variant="outline"
            onClick={() => {
              onState("joining");
            }}
          >
            Вступить в группу продукта
          </Button>
        </>
      ) : null}
      {state === "joining" ? (
        <>
          <p className="mt-2 text-sm leading-6" role="status">
            Заявка на вступление отправлена. Ждём подтверждения.
          </p>
          <DemoEvent
            onClick={() => {
              onState("member");
            }}
          >
            Бот подтвердил вступление
          </DemoEvent>
        </>
      ) : null}
      {state === "joinError" ? (
        <>
          <p className="mt-2 text-sm leading-6" role="alert">
            Не удалось подготовить приглашение. Доступ к продукту открыт.
          </p>
          <Button
            className="mt-4 min-h-11"
            variant="outline"
            onClick={() => {
              onState("invitation");
            }}
          >
            Повторить получение приглашения
          </Button>
        </>
      ) : null}
      {state === "member" ? (
        <>
          <p className="mt-2 text-sm leading-6">
            Вы уже в группе этого продукта.
          </p>
          <Button
            className="mt-4 min-h-11"
            variant="outline"
            onClick={() => {
              onState("member");
            }}
          >
            Открыть группу
          </Button>
        </>
      ) : null}
    </section>
  );
}

function PurchaseHistory({
  state,
  onContinue,
}: {
  readonly state: BuyerState;
  readonly onContinue: () => void;
}) {
  const refunded = state === "refunded" || state === "otherGrant";
  return (
    <div className="mt-6 grid gap-8">
      <section aria-label="Текущий доступ">
        <h2 className="text-lg font-semibold">Доступ к продуктам</h2>
        <div className="mt-4 border-b border-border pb-5">
          <h3 className="font-semibold">{productName}</h3>
          <p className="mt-2 text-sm leading-6">
            {state === "refunded"
              ? "Доступ по покупке прекращён. История обучения сохранена."
              : state === "otherGrant"
                ? "Доступ открыт по ручному назначению. Права возвращённой покупки прекращены."
                : "Доступ открыт без даты окончания. Сопровождение до 14 апреля 2027."}
          </p>
          {state === "refunded" ? null : (
            <Button className="mt-4 min-h-11" onClick={onContinue}>
              Открыть продукт
            </Button>
          )}
        </div>
        {state === "purchases" ? (
          <div className="mt-4">
            <h3 className="font-semibold">Инженерная практика</h3>
            <p className="mt-2 text-sm">
              Оплата подтверждена. Доступ готовится.
            </p>
            <Button
              className="mt-3 min-h-11"
              variant="outline"
              onClick={onContinue}
            >
              Продолжить оформление
            </Button>
          </div>
        ) : null}
      </section>
      <section aria-label="История покупок">
        <h2 className="text-lg font-semibold">История покупок</h2>
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="font-semibold">{productName}</h3>
          <p className="mt-2 text-sm">
            14 октября 2026 · 100 ₽ ·{" "}
            {refunded ? "Возвращено полностью" : "Оплачено"}
          </p>
          <details className="mt-3 text-sm leading-6">
            <summary className="cursor-pointer">
              Чек, состав и права покупки
            </summary>
            <p className="mt-2">
              DEMO-1442 · Материалы продукта и 6 месяцев сопровождения.
            </p>
            <p>
              {refunded
                ? "Банк подтвердил возврат 100 ₽. Прекращены только права этой покупки."
                : "Чек отправлен. Доступ к продукту открыт."}
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}
