"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import styles from "./payment-links-prototype.module.css";

type LinkState =
  "active" | "pending" | "unknown" | "paid" | "revoked" | "expired" | "failed";
type Variant = "A" | "B" | "C";
const variants: Variant[] = ["A", "B", "C"];
const names = { A: "Форма и итог", B: "В строке продукта", C: "По шагам" };
const states: Record<LinkState, string> = {
  active: "Готова к оплате",
  pending: "Оплата начата",
  unknown: "Ждём подтверждения банка",
  paid: "Оплачено",
  revoked: "Ссылка отозвана",
  expired: "Срок ссылки истёк",
  failed: "Оплата не прошла",
};
const money = (amount: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(amount);

/** Throwaway visual proof for #1450. All products, links and bank transitions are in-memory fixtures. */
export function PaymentLinksPrototype({
  initialState = "active",
  initialBuyer = false,
}: {
  readonly initialState?: LinkState;
  readonly initialBuyer?: boolean;
}) {
  const [variant, setVariant] = useState<Variant>(() => {
    const query = new URL(window.location.href).searchParams.get("variant");
    return query === "B" || query === "C" ? query : "A";
  });
  const [product, setProduct] = useState("aie");
  const [mode, setMode] = useState("discount");
  const [value, setValue] = useState("10");
  const [expiration, setExpiration] = useState("");
  const [created, setCreated] = useState(initialBuyer);
  const [buyer, setBuyer] = useState(initialBuyer);
  const [state, setState] = useState<LinkState>(initialState);
  const [message, setMessage] = useState("");
  const [step, setStep] = useState(1);
  const [accepted, setAccepted] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [copied, setCopied] = useState(false);
  const base = product === "aie" ? 29000 : 5000;
  const title = product === "aie" ? "AI Engineering" : "Практика TypeScript";
  const numericValue = Number(value.replace(",", "."));
  const amount =
    Math.round(
      (mode === "discount" ? base * (1 - numericValue / 100) : numericValue) *
        100,
    ) / 100;
  const valid =
    value.trim() !== "" &&
    Number.isFinite(amount) &&
    amount >= 1 &&
    amount <= 1000000 &&
    numericValue >= 0 &&
    (mode !== "discount" || numericValue < 100);
  const link = "https://example.invalid/pay/demo-aie";
  const available = state === "active" || state === "failed";
  function changeVariant(offset: number) {
    const next =
      variants[
        (variants.indexOf(variant) + offset + variants.length) % variants.length
      ];
    if (next === undefined) return;
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
  }
  const summary = (
    <section className={styles["summary"]} aria-label="Условия покупки">
      <h2>{title}</h2>
      <p className={styles["amount"]}>
        {valid ? money(amount) : "Укажите сумму"}
      </p>
      {valid && amount < base && (
        <p>
          Обычная цена {money(base)} · скидка {money(base - amount)}
        </p>
      )}
      <ul>
        <li>Материалы без ограничения срока</li>
        {product === "aie" && <li>Чат продукта без ограничения срока</li>}
      </ul>
      <details>
        <summary>Все условия покупки</summary>
        <p>
          {product === "aie"
            ? "Сопровождение автора — 6 месяцев. Половина цены относится к материалам и чату, половина — к сопровождению."
            : "Чат и сопровождение не входят. Вся цена относится к материалам."}
        </p>
        <p>
          Сроки начинаются после подтверждения оплаты. Окончание сопровождения
          не закрывает материалы и чат.
        </p>
      </details>
    </section>
  );
  const form = (
    <form
      className={styles["form"]}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) {
          setMessage(
            "Укажите сумму от 1 до 1 000 000 ₽. Бесплатный доступ выдаётся через назначение доступа.",
          );
          return;
        }
        if (variant === "C" && step === 1) {
          setStep(2);
          return;
        }
        if (
          expiration !== "" &&
          Date.parse(`${expiration}:00+03:00`) <= Date.now()
        ) {
          setMessage("Укажите будущую дату окончания действия ссылки.");
          return;
        }
        setCreated(true);
        setState("active");
        setMessage("Ссылка создана. Отправьте её покупателю самостоятельно.");
      }}
    >
      <label htmlFor="link-product">Продукт</label>
      <select
        id="link-product"
        name="product"
        value={product}
        onChange={(event) => {
          setProduct(event.target.value);
          setCreated(false);
        }}
        disabled={created}
      >
        <option value="aie">AI Engineering</option>
        <option value="typescript">Практика TypeScript</option>
      </select>
      <fieldset>
        <legend>Цена по ссылке</legend>
        <label>
          <input
            name="price-mode"
            type="radio"
            checked={mode === "discount"}
            onChange={() => {
              setMode("discount");
              setValue("10");
            }}
            disabled={created}
          />{" "}
          Скидка, %
        </label>
        <label>
          <input
            name="price-mode"
            type="radio"
            checked={mode === "amount"}
            onChange={() => {
              setMode("amount");
              setValue("26100");
            }}
            disabled={created}
          />{" "}
          Итоговая сумма, ₽
        </label>
      </fieldset>
      <label htmlFor="link-value">
        {mode === "discount" ? "Размер скидки, %" : "Сумма к оплате, ₽"}
      </label>
      <input
        id="link-value"
        name="value"
        inputMode="decimal"
        required
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        disabled={created}
        aria-describedby="price-help"
      />
      <p id="price-help">
        Анкетную скидку владелец проверяет вручную. Бесплатный доступ выдайте
        через назначение доступа.
      </p>
      {(variant !== "C" || step === 2) && (
        <>
          <label htmlFor="link-expiry">
            Действует до, Europe/Moscow · необязательно
          </label>
          <input
            id="link-expiry"
            name="expiration"
            type="datetime-local"
            value={expiration}
            onChange={(event) => {
              setExpiration(event.target.value);
            }}
            disabled={created}
          />
          <p>Без даты ссылка действует до одной успешной покупки или отзыва.</p>
        </>
      )}
      {!created && (
        <Button type="submit">
          {variant === "C" && step === 1 ? "Далее" : "Создать ссылку"}
        </Button>
      )}
    </form>
  );
  return (
    <div className={styles["root"]} data-variant={variant}>
      <p className={styles["notice"]}>
        Интерактивный прототип · данные вымышлены · реальные платежи отключены
      </p>
      <header className={styles["header"]}>
        <div>
          <h1>{buyer ? "Покупка по ссылке" : "Ссылки на оплату"}</h1>
          <p>
            {buyer
              ? "Доступ получит аккаунт, с которого вы оплатите покупку."
              : "Выберите продукт и согласованную цену. Публичная цена останется прежней."}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setBuyer(!buyer);
          }}
        >
          {buyer ? "Вид владельца" : "Вид покупателя"}
        </Button>
      </header>
      {buyer ? (
        <div className={styles["workspace"]}>
          {summary}
          <section className={styles["buyer"]}>
            <h2>{states[state]}</h2>
            {available && (
              <>
                <p>
                  По ссылке можно совершить одну покупку. Её можно передать
                  другому человеку.
                </p>
                <p>
                  {expiration === ""
                    ? "Без ограничения срока действия ссылки."
                    : `Действует до ${expiration.replace("T", " ")} (Москва).`}
                </p>
                {!signedIn ? (
                  <Button
                    onClick={() => {
                      setSignedIn(true);
                    }}
                  >
                    Войти для покупки
                  </Button>
                ) : (
                  <>
                    <p>Покупатель: learner@example.invalid</p>
                    <label className={styles["consent"]}>
                      <input
                        type="checkbox"
                        checked={accepted}
                        onChange={(event) => {
                          setAccepted(event.target.checked);
                        }}
                      />{" "}
                      Принимаю оферту и условия покупки
                    </label>
                    <details>
                      <summary>Документы и распределение цены</summary>
                      <p>
                        Проект оферты редакции 6 · общие условия · политика
                        персональных данных. В реализации покупатель увидит
                        опубликованные документы.
                      </p>
                    </details>
                    <Button
                      disabled={!accepted || !valid}
                      onClick={() => {
                        setState("pending");
                      }}
                    >
                      Перейти к оплате {valid ? money(amount) : ""}
                    </Button>
                  </>
                )}
              </>
            )}
            {(state === "pending" || state === "unknown") && (
              <p>
                Банк ещё не подтвердил результат. Не начинайте новую оплату.
                Ссылка зарезервирована за текущей попыткой.
              </p>
            )}
            {state === "paid" && (
              <>
                <p>Банк подтвердил оплату. Доступ к продукту готов.</p>
                <Button
                  onClick={() => {
                    setMessage(
                      "В реализации откроется купленный продукт с программой и шагами подключения Telegram.",
                    );
                  }}
                >
                  Открыть продукт
                </Button>
                <p>Повторная покупка по этой ссылке недоступна.</p>
              </>
            )}
            {(state === "expired" || state === "revoked") && (
              <p>
                Оплатить по этой ссылке нельзя. Запросите у владельца новую
                ссылку.
              </p>
            )}
            {state === "failed" && (
              <p>
                Банк подтвердил неуспешную оплату. Вы можете попробовать снова.
              </p>
            )}
          </section>
        </div>
      ) : (
        <>
          {variant === "B" && (
            <section className={styles["productRow"]}>
              <strong>{title}</strong>
              <span>Продажи закрыты</span>
              <span>Публичная цена {money(base)}</span>
            </section>
          )}
          <div className={styles["workspace"]}>
            {form}
            {summary}
          </div>
          {created && (
            <section className={styles["issued"]}>
              <h2>{states[state]}</h2>
              <label htmlFor="created-link">Ссылка для покупателя</label>
              <input id="created-link" value={link} readOnly />
              <div className={styles["actions"]}>
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(
                      () => {
                        setCopied(true);
                      },
                      () => {
                        setMessage("Скопируйте ссылку вручную из поля.");
                      },
                    );
                  }}
                >
                  {copied ? "Скопировано" : "Скопировать ссылку"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBuyer(true);
                  }}
                >
                  Посмотреть оформление
                </Button>
                <Button
                  variant="destructive"
                  disabled={!available}
                  onClick={() => {
                    setState("revoked");
                  }}
                >
                  Отозвать ссылку
                </Button>
              </div>
              <p>
                Ссылка одноразовая. Создание и копирование не отправляют
                сообщения.
              </p>
              {!available && (
                <p>
                  Начатый платёж ждёт результата банка. Отзыв ссылки не отменяет
                  успешную покупку.
                </p>
              )}
            </section>
          )}
        </>
      )}
      <p role="status">{message}</p>
      <details className={styles["simulation"]}>
        <summary>Состояния прототипа</summary>
        <label htmlFor="demo-state">Результат банка или состояние ссылки</label>
        <select
          id="demo-state"
          value={state}
          onChange={(event) => {
            const next = event.target.value;
            const knownStates: LinkState[] = [
              "active",
              "pending",
              "unknown",
              "paid",
              "revoked",
              "expired",
              "failed",
            ];
            const selected = knownStates.find(
              (candidate) => candidate === next,
            );
            if (selected !== undefined) setState(selected);
          }}
        >
          {Object.entries(states).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <p>
          Суммы, сроки и состав в рабочем интерфейсе определяет сервер. Второй
          продукт здесь — пример без чата.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setCreated(false);
            setState("active");
            setMessage("");
            setStep(1);
            setSignedIn(false);
            setAccepted(false);
            setCopied(false);
          }}
        >
          Сбросить пример
        </Button>
      </details>
      {!buyer && (
        <nav
          className={styles["switcher"]}
          aria-label="Варианты прототипа"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") changeVariant(-1);
            if (event.key === "ArrowRight") changeVariant(1);
          }}
        >
          <Button
            variant="ghost"
            aria-label="Предыдущий вариант"
            onClick={() => {
              changeVariant(-1);
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <span>
            {variant} · {names[variant]}
          </span>
          <Button
            variant="ghost"
            aria-label="Следующий вариант"
            onClick={() => {
              changeVariant(1);
            }}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
