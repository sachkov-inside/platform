import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  FileText,
  Users,
  KeyRound,
  Layers,
  Search,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { DemoControls } from "./demo-controls.prototype";

const products = ["Создание Platform Inside", "AI Engineering"];
const materials = [
  {
    title: "Контекст задачи и границы системы",
    products: [0, 1],
    state: "Опубликован",
    readOnly: false,
  },
  {
    title: "Первый вертикальный срез",
    products: [0],
    state: "Черновик",
    readOnly: false,
  },
  {
    title: "Как проверить решение агента",
    products: [1],
    state: "Опубликован",
    readOnly: true,
  },
  {
    title: "Шаблон технического решения",
    products: [],
    state: "Черновик",
    readOnly: false,
  },
];
const sections = ["Материалы", "Участники", "Доступ"];

export function Workspace({ variant }: { readonly variant: number }) {
  const [product, setProduct] = useState(0);
  const [area, setArea] = useState("products");
  const [section, setSection] = useState("Материалы");
  const [baselineSection, setBaselineSection] = useState("Состав");
  const [materialFilter, setMaterialFilter] = useState("all");
  const [detail, setDetail] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [filter, setFilter] = useState("");
  const [boundary, setBoundary] = useState("author");
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState("");
  const current = detail === null ? undefined : materials[detail];
  const isReadOnly = boundary !== "author" || current?.readOnly === true;
  const rows = materials.filter(
    (material) =>
      (area === "shared"
        ? materialFilter === "all" ||
          (materialFilter === "none"
            ? material.products.length === 0
            : material.products.includes(Number(materialFilter)))
        : material.products.includes(product)) &&
      material.title.toLowerCase().includes(filter.toLowerCase()),
  );
  function changeArea(next: string) {
    setArea(next);
    setDetail(null);
    setReading(false);
    setEditor(false);
  }
  function openMaterial(title: string) {
    const index = materials.findIndex((item) => item.title === title);
    setDetail(index);
    setDraft(title);
    setReading(false);
    setEditor(false);
  }
  const content =
    current !== undefined ? (
      <div className="lab-document">
        <button
          type="button"
          className="lab-back"
          onClick={() => {
            setDetail(null);
            setReading(false);
            setEditor(false);
          }}
        >
          <ArrowLeft size={16} aria-hidden="true" />К материалам{" "}
          {area === "shared" ? "всех продуктов" : products[product]}
        </button>
        <div className="lab-section-heading">
          <span className="lab-tag">
            {reading
              ? "Публичное чтение"
              : editor
                ? "Редактирование"
                : "Авторский Preview"}
          </span>
          <span>{current.state}</span>
        </div>
        <h2>{current.title}</h2>
        <p className="lab-muted">
          Входит в:{" "}
          {current.products.length === 0
            ? "Общие материалы · без продукта"
            : current.products.map((id) => products[id]).join(" и ")}
        </p>
        <p>
          Сначала определите задачу человека. Затем назовите границы системы,
          проверяемый результат и ограничения решения.
        </p>
        {isReadOnly ? (
          <p className="lab-notice">
            {boundary === "viewer"
              ? "Нет права редактирования. Доступен просмотр."
              : "Материал перенесён из источника. Изменения вносятся в оригинале."}
          </p>
        ) : null}
        {editor ? (
          <label className="lab-field">
            Название материала
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
            />
            <span>Локальный черновик: {draft}</span>
          </label>
        ) : null}
        <div className="lab-actions">
          {!reading && !isReadOnly ? (
            <Button
              variant="outline"
              onClick={() => {
                setEditor(!editor);
              }}
            >
              {editor ? "К Preview" : "Редактировать"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              if (current.state === "Опубликован") setReading(!reading);
            }}
            disabled={current.state !== "Опубликован"}
          >
            {reading
              ? "Вернуться в авторский Preview"
              : "Открыть публичное чтение"}
            <ArrowUpRight aria-hidden="true" />
          </Button>
        </div>
        <p className="lab-muted">
          Preview не публикует материал. Публичное чтение доступно только для
          опубликованного состояния.
        </p>
      </div>
    ) : section === "Участники" && area !== "shared" ? (
      <section>
        <h2>Участники · {products[product]}</h2>
        <p className="lab-muted">
          Демонстрационный состав, без персональных данных.
        </p>
        {[
          "Анна · учится",
          "Михаил · доступ до 15.04.2027",
          "Ольга · приглашение не принято",
        ].map((person) => (
          <div className="lab-data-row" key={person}>
            <Users aria-hidden="true" size={18} />
            <span>{person}</span>
          </div>
        ))}
      </section>
    ) : section === "Доступ" && area !== "shared" ? (
      <section>
        <h2>Доступ · {products[product]}</h2>
        <p>
          Материалы продукта доступны участникам с действующим правом на этот
          продукт.
        </p>
        <div className="lab-data-row">
          <KeyRound aria-hidden="true" size={18} />
          <span>Сообщество продукта · Telegram</span>
          <span className="lab-tag">Входит в пример</span>
        </div>
        <p className="lab-notice">
          Общий материал не даёт доступ ко второму продукту. Здесь нельзя выдать
          или отозвать реальные права.
        </p>
      </section>
    ) : (
      <section>
        <div className="lab-section-heading">
          <h2>
            {area === "shared" ? "Общие материалы" : "Материалы продукта"}
          </h2>
          <span className="lab-muted">{rows.length}</span>
        </div>
        <label className="lab-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">Найти материал</span>
          <input
            placeholder="Найти материал"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
          />
        </label>
        {area === "shared" ? (
          <label className="lab-field lab-inline-field">
            Фильтр продукта
            <select
              value={materialFilter}
              onChange={(e) => {
                setMaterialFilter(e.target.value);
              }}
            >
              <option value="all">Все материалы</option>
              {products.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
              <option value="none">Без продукта</option>
            </select>
            <span>Контекст продукта сохранён: {products[product]}</span>
          </label>
        ) : null}
        {rows.length === 0 ? (
          <p>Материалы не найдены. Измените запрос.</p>
        ) : (
          rows.map((item) => (
            <button
              type="button"
              className="lab-material-row"
              key={item.title}
              onClick={() => {
                openMaterial(item.title);
              }}
            >
              <FileText aria-hidden="true" size={20} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.products.length > 1
                    ? "В двух продуктах"
                    : item.products.length === 0
                      ? "Без продукта"
                      : products[item.products[0] ?? 0]}
                  {item.readOnly ? " · Из источника" : ""}
                </small>
              </span>
              <span className="lab-material-state">{item.state}</span>
              <ChevronRight aria-hidden="true" size={17} />
            </button>
          ))
        )}
      </section>
    );
  return (
    <>
      <DemoControls>
        <label>
          Права
          <select
            value={boundary}
            onChange={(e) => {
              setBoundary(e.target.value);
            }}
          >
            <option value="author">Автор</option>
            <option value="viewer">Только просмотр</option>
            <option value="imported">Из источника</option>
          </select>
        </label>
      </DemoControls>
      <div className={`lab-workspace lab-workspace-${String(variant)}`}>
        <nav className="lab-editor-nav" aria-label="Навигация редактора">
          <strong>Редактор</strong>
          {[
            "Продукты",
            "Материалы",
            ...(variant === 0 ? ["Темы", "Доступ"] : []),
          ].map((name) => (
            <button
              type="button"
              key={name}
              aria-current={
                (name === "Продукты" && area === "products") ||
                (name === "Материалы" && area === "shared")
                  ? "page"
                  : undefined
              }
              onClick={() => {
                changeArea(
                  name === "Продукты"
                    ? "products"
                    : name === "Темы"
                      ? "topics"
                      : name === "Доступ"
                        ? "access"
                        : "shared",
                );
              }}
            >
              {name === "Продукты" ? (
                <Layers size={17} aria-hidden="true" />
              ) : (
                <BookOpen size={17} aria-hidden="true" />
              )}
              {name === "Материалы" && variant !== 0 ? "Общие материалы" : name}
            </button>
          ))}
        </nav>
        <div className="lab-workspace-main">
          {area === "access" ? (
            <section>
              <h2>Доступ · общий раздел</h2>
              <p>
                Участники всех продуктов. В текущем редакторе этот раздел
                находится вне продукта.
              </p>
              {[
                "Анна · Создание Platform Inside",
                "Михаил · AI Engineering",
              ].map((person) => (
                <div key={person} className="lab-data-row">
                  {person}
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => {
                  changeArea("products");
                }}
              >
                К выбранному продукту
              </Button>
            </section>
          ) : area === "topics" ? (
            <section>
              <h2>Темы</h2>
              <p>
                Темы остаются в текущем редакторе. Удаление раздела и данных
                требует решения в #1448.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  changeArea("products");
                }}
              >
                К продуктам
              </Button>
            </section>
          ) : (
            <>
              <div className="lab-product-heading">
                <div>
                  <span className="lab-muted">
                    {area === "shared" ? "Библиотека автора" : "Продукт"}
                  </span>
                  <h2>
                    {area === "shared" ? "Общие материалы" : products[product]}
                  </h2>
                </div>
                <label className="lab-field">
                  <span className="sr-only">Выбрать продукт</span>
                  <select
                    aria-label="Выбрать продукт"
                    value={product}
                    onChange={(e) => {
                      setProduct(Number(e.target.value));
                      setDetail(null);
                    }}
                  >
                    {products.map((name, i) => (
                      <option value={i} key={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {area !== "shared" && detail === null ? (
                variant === 2 ? (
                  <div className="lab-product-overview">
                    <div>
                      <h3>Всё для работы с продуктом</h3>
                      <p>Состав, люди и правила доступа находятся здесь.</p>
                    </div>
                    <div className="lab-overview-sections">
                      {sections.map((name, i) => (
                        <button
                          type="button"
                          key={name}
                          aria-pressed={section === name}
                          onClick={() => {
                            setSection(name);
                          }}
                        >
                          <strong>{name}</strong>
                          <span>
                            {
                              [
                                "Программа и общие материалы",
                                "Кто учится и кому нужна помощь",
                                "Права и сообщество продукта",
                              ][i]
                            }
                          </span>
                          <ArrowUpRight aria-hidden="true" size={18} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <nav
                    aria-label="Разделы продукта"
                    className={
                      variant === 1
                        ? "lab-local-sections"
                        : "lab-baseline-sections"
                    }
                  >
                    {(variant === 0
                      ? ["Настройки", "Состав", "Артефакты"]
                      : sections
                    ).map((name) => (
                      <button
                        type="button"
                        key={name}
                        aria-current={
                          (
                            variant === 0
                              ? baselineSection === name
                              : section === name
                          )
                            ? "page"
                            : undefined
                        }
                        onClick={() => {
                          if (variant === 0) setBaselineSection(name);
                          else setSection(name);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </nav>
                )
              ) : null}
              {variant === 0 && area !== "shared" && detail === null ? (
                <p className="lab-notice">
                  База повторяет структуру текущего редактора: настройки, состав
                  и артефакты. Участники и доступ находятся в общем разделе
                  «Доступ».
                </p>
              ) : null}
              <div className="lab-workspace-body">
                {variant === 0 &&
                area === "products" &&
                detail === null &&
                baselineSection === "Настройки" ? (
                  <section>
                    <h2>Настройки продукта</h2>
                    <label className="lab-field">
                      Название продукта
                      <input
                        defaultValue={products[product]}
                        readOnly={boundary !== "author"}
                      />
                    </label>
                    <p className="lab-muted">
                      Адрес: /products/
                      {product === 0 ? "platform-inside" : "ai-engineering"}
                    </p>
                    <label className="lab-field">
                      Краткое описание
                      <textarea
                        defaultValue="Соберите приложение с агентом и доведите его до первого релиза."
                        readOnly={boundary !== "author"}
                      />
                    </label>
                    <p className="lab-notice">
                      Демонстрационный черновик. Настройки никуда не
                      отправляются.
                    </p>
                  </section>
                ) : variant === 0 &&
                  area === "products" &&
                  detail === null &&
                  baselineSection === "Артефакты" ? (
                  <section>
                    <h2>Артефакты продукта</h2>
                    <div className="lab-data-row">
                      Шаблон технического решения.pdf
                    </div>
                  </section>
                ) : variant === 0 && area === "products" && detail === null ? (
                  <>
                    <p className="lab-muted">Состав продукта</p>
                    {content}
                  </>
                ) : (
                  content
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="lab-source-note">
        {variant === 0
          ? "База: схема текущих authoring routes на исходном main. Копия структуры с локальной навигацией, не production-экран."
          : variant === 1
            ? "Идея: blocks.so sidebar и Astryx settings-sidebar. Разделы остаются рядом с выбранным продуктом."
            : "Идея: отдельный обзор продукта. Сначала выбираем задачу, затем работаем с её содержимым."}
      </p>
    </>
  );
}
