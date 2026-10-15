import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { DemoControls } from "./demo-controls.prototype";

type Result =
  | "empty"
  | "editing"
  | "submitting"
  | "success"
  | "field-error"
  | "unavailable";
export function CreationForm({ variant }: { readonly variant: number }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [result, setResult] = useState<Result>("empty");
  const [response, setResponse] = useState("success");
  const [nameError, setNameError] = useState("");
  const [slugError, setSlugError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const slugInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const pending = result === "submitting";
  const proposed = variant === 1;
  useEffect(() => {
    if (result === "field-error" && proposed) {
      if (nameError.length > 0) nameInput.current?.focus();
      else if (slugError.length > 0) slugInput.current?.focus();
    }
  }, [result, proposed, nameError, slugError]);
  function finish() {
    if (response === "unavailable") {
      setResult("unavailable");
      feedback.current?.focus();
      return;
    }
    if (slug === "platform-inside") {
      setSlugError(
        "Этот адрес уже занят. Введите другой, например platform-practice.",
      );
      setResult("field-error");
      if (proposed) slugInput.current?.focus();
      return;
    }
    setResult("success");
  }
  function demo(next: string) {
    if (next === "empty") {
      setName("");
      setSlug("");
      setSummary("");
    } else {
      setName("Создание Platform Inside");
      setSlug(next === "field-error" ? "platform-inside" : "platform-practice");
      setSummary("От задачи человека до первого релиза приложения.");
    }
    setNameError("");
    setSlugError(
      next === "field-error"
        ? "Этот адрес уже занят. Введите другой, например platform-practice."
        : "",
    );
    const state = [
      "empty",
      "editing",
      "submitting",
      "success",
      "field-error",
      "unavailable",
    ].find((item): item is Result => item === next);
    setResult(state ?? "empty");
  }
  return (
    <>
      <DemoControls>
        <label>
          Пример
          <select
            aria-label="Состояние формы"
            value={result}
            onChange={(e) => {
              demo(e.target.value);
            }}
          >
            <option value="empty">Пустая форма</option>
            <option value="editing">Заполнено</option>
            <option value="submitting">Отправка</option>
            <option value="success">Успех</option>
            <option value="field-error">Занятый адрес</option>
            <option value="unavailable">Сервер недоступен</option>
          </select>
        </label>
        <label>
          Ответ сервера
          <select
            value={response}
            onChange={(e) => {
              setResponse(e.target.value);
            }}
          >
            <option value="success">Успех или занятый адрес</option>
            <option value="unavailable">Сервер недоступен</option>
          </select>
        </label>
        {pending ? (
          <Button variant="outline" onClick={finish}>
            Получить ответ
          </Button>
        ) : null}
      </DemoControls>
      <section className="lab-form-surface">
        <header>
          <h2>Создать продукт</h2>
          <p>
            {proposed
              ? "Сначала задайте название, затем выберите постоянный адрес."
              : "Продукты"}
          </p>
        </header>
        {result === "success" ? (
          <div className="lab-success">
            <Check aria-hidden="true" size={24} />
            <h3
              ref={(node) => {
                node?.focus();
              }}
              tabIndex={-1}
            >
              Продукт «{name}» создан в примере
            </h3>
            <p>Адрес: /products/{slug}</p>
            <p>Продукт ещё не опубликован.</p>
            <Button
              onClick={() => {
                setResult("editing");
              }}
            >
              Вернуться к введённым данным
            </Button>
          </div>
        ) : (
          <form
            noValidate
            aria-label="Создание продукта"
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              const invalidName = name.trim().length === 0;
              const invalidSlug = slugInput.current?.validity.valid !== true;
              setNameError(invalidName ? "Введите название продукта." : "");
              setSlugError(
                invalidSlug
                  ? "Используйте латинские строчные буквы, цифры и дефис между словами."
                  : "",
              );
              if (invalidName || invalidSlug) {
                setResult("field-error");
                if (proposed)
                  (invalidName ? nameInput : slugInput).current?.focus();
                return;
              }
              setResult("submitting");
            }}
          >
            <fieldset
              disabled={pending}
              className={
                proposed
                  ? "lab-form-fields"
                  : "lab-form-fields lab-form-baseline"
              }
            >
              <legend>
                {proposed ? "Название и описание" : "Данные продукта"}
              </legend>
              <label className="lab-field" htmlFor="lab-name">
                Название<span className="lab-required">Обязательно</span>
                <input
                  id="lab-name"
                  name="name"
                  ref={nameInput}
                  value={name}
                  maxLength={120}
                  required
                  aria-invalid={nameError.length > 0}
                  aria-describedby={
                    proposed ? "lab-name-help lab-name-error" : undefined
                  }
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError("");
                  }}
                />
                {proposed ? (
                  <>
                    <small id="lab-name-help">
                      Название увидят участники. Его можно изменить позже.
                    </small>
                    <span className="lab-error" id="lab-name-error">
                      {nameError}
                    </span>
                  </>
                ) : null}
              </label>
              <label className="lab-field lab-summary" htmlFor="lab-summary">
                Краткое описание<span className="lab-muted">Необязательно</span>
                <textarea
                  name="summary"
                  id="lab-summary"
                  value={summary}
                  maxLength={500}
                  onChange={(e) => {
                    setSummary(e.target.value);
                  }}
                />
              </label>
              {proposed ? (
                <div className="lab-field-group-title">
                  <h3>Адрес страницы</h3>
                  <p>Постоянная ссылка на продукт.</p>
                </div>
              ) : null}
              <label className="lab-field" htmlFor="lab-slug">
                Адрес
                {!proposed ? (
                  <small>После создания не меняется</small>
                ) : (
                  <span className="lab-required">Обязательно</span>
                )}
                <input
                  id="lab-slug"
                  name="slug"
                  ref={slugInput}
                  value={slug}
                  maxLength={120}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={slugError.length > 0}
                  aria-describedby={
                    proposed ? "lab-slug-help lab-slug-error" : undefined
                  }
                  placeholder="platform-practice"
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugError("");
                  }}
                />
                {proposed ? (
                  <>
                    <small id="lab-slug-help">
                      /products/{slug.length > 0 ? slug : "ваш-адрес"} · После
                      создания не меняется.
                    </small>
                    <span className="lab-error" id="lab-slug-error">
                      {slugError}
                    </span>
                  </>
                ) : null}
              </label>
            </fieldset>
            <div
              className="lab-form-feedback"
              ref={feedback}
              tabIndex={-1}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {pending
                ? "Создаём продукт… Нажмите «Получить ответ» в панели состояний."
                : result === "unavailable"
                  ? "Сервер недоступен. Данные сохранены в форме. Повторите создание продукта."
                  : result === "field-error" &&
                      (!proposed ||
                        nameError.length > 0 ||
                        slugError.length > 0)
                    ? proposed
                      ? "Не удалось создать продукт. Исправьте отмеченное поле."
                      : slug === "platform-inside"
                        ? "Такой slug уже занят. Выберите другой."
                        : "Проверьте название, slug и длину описания."
                    : ""}
            </div>
            <Button disabled={pending} type="submit">
              <Plus aria-hidden="true" />
              {pending
                ? "Создаём…"
                : result === "unavailable"
                  ? "Повторить создание"
                  : "Создать продукт"}
            </Button>
          </form>
        )}
        <p role="status" className="sr-only">
          {result === "success" ? `Продукт ${name} создан в примере.` : ""}
        </p>
      </section>
      <p className="lab-source-note">
        {proposed
          ? "Идея: HeroUI TextField, Appica Field/Form и blocks.so form-layout. Существующая основа компонентов; ошибки связаны с полями, фокус переходит к первой ошибке."
          : "База: поля и общая ошибка текущей формы ContentCollectionsPageClient; локальное воспроизведение без API."}{" "}
        Занятый адрес для проверки: platform-inside.
      </p>
    </>
  );
}
