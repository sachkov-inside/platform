"use client";

/** Prototype #1468 — one complete Inside authoring experience, not laboratory chrome.
 * THESIS: Product context owns the task; navigation recedes around readable content.
 * OWN-WORLD: Inside's Manrope, warm paper, charcoal actions, restrained rounded surfaces.
 * STORY: Browse Products, open programme, edit a Material, inspect people and access.
 * FIRST VIEWPORT: Compact identity, clear page title, authored covers and useful content.
 * MOBILE: One column and persistent thumb navigation; desktop gains one quiet sidebar.
 * References inform interaction patterns only. All content and mutations are fixtures.
 */
import { useRef, useState, type ReactNode } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FileText,
  KeyRound,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import "./inside-concept.prototype.css";

const architectureCover = new URL(
  "./inside-concept-assets/architecture.webp",
  import.meta.url,
).href;
const engineeringCover = new URL(
  "./inside-concept-assets/engineering.webp",
  import.meta.url,
).href;
const initialBody =
  "Хорошее решение начинается с задачи человека. До выбора инструментов определите, какой результат нужен и как вы его проверите.\n\nСформулируйте границы системы: что она делает, с чем взаимодействует и что остаётся за её пределами.\n\nНачните с одного вертикального среза. Он должен пройти весь путь от действия пользователя до сохранённого результата.";
const startingProducts = [
  {
    name: "Создание Platform Inside",
    description: "От задачи человека до первого релиза приложения.",
    cover: architectureCover,
    state: "Черновик",
    count: 6,
  },
  {
    name: "AI Engineering",
    description: "Разработка с агентами: от контекста до работающей системы.",
    cover: engineeringCover,
    state: "Опубликован",
    count: 4,
  },
];
const startingMaterials = [
  {
    title: "Контекст задачи и границы системы",
    type: "Гайд",
    duration: "12 мин",
    published: true,
    chapter: 1,
    products: [0, 1],
  },
  {
    title: "Первый вертикальный срез",
    type: "Видео",
    duration: "24 мин",
    published: true,
    chapter: 1,
    products: [0],
  },
  {
    title: "Как проверить решение агента",
    type: "Гайд",
    duration: "8 мин",
    published: true,
    chapter: 1,
    products: [0, 1],
  },
  {
    title: "От локального запуска к релизу",
    type: "Гайд",
    duration: "15 мин",
    published: false,
    chapter: 2,
    products: [0, 1],
  },
  {
    title: "Проверки, которым можно доверять",
    type: "Видео",
    duration: "18 мин",
    published: false,
    chapter: 2,
    products: [0, 1],
  },
  {
    title: "Что делать, когда всё сломалось",
    type: "Гайд",
    duration: "10 мин",
    published: false,
    chapter: 2,
    products: [0],
  },
];
const people = [
  {
    name: "Анна Смирнова",
    initials: "АС",
    detail: "Проходит первую главу",
    access: "Доступ открыт",
  },
  {
    name: "Михаил Волков",
    initials: "МВ",
    detail: "Telegram подключён",
    access: "Доступ открыт",
  },
  {
    name: "Ольга Петрова",
    initials: "ОП",
    detail: "Приглашение ещё не принято",
    access: "Приглашение",
  },
];
type Screen =
  | "products"
  | "product"
  | "materials"
  | "people"
  | "profile"
  | "editor"
  | "preview";
const navItems = [
  { screen: "products", label: "Продукты", icon: Layers },
  { screen: "materials", label: "Материалы", icon: BookOpen },
  { screen: "people", label: "Участники", icon: Users },
  { screen: "profile", label: "Профиль", icon: Settings2 },
] as const;
const references = [
  {
    name: "Linear",
    detail: "Иерархия, спокойная плотность и контекстные действия",
    url: "https://linear.app/now/how-we-redesigned-the-linear-ui",
  },
  {
    name: "Notion",
    detail: "Контекст продукта и постоянная мобильная навигация",
    url: "https://www.notion.com/en-us/help/workspaces-on-mobile",
  },
  {
    name: "GitHub · Primer",
    detail: "Разделение общей и локальной навигации",
    url: "https://primer.style/product/ui-patterns/navigation/",
  },
  {
    name: "ChatGPT",
    detail: "Быстрый поиск по рабочему содержимому",
    url: "https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt",
  },
  {
    name: "Claude",
    detail: "Работа внутри выбранного проекта",
    url: "https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects",
  },
  {
    name: "X",
    detail: "Читаемый поток и действия рядом с содержимым",
    url: "https://help.x.com/en/using-x/x-ios-app",
  },
];
function IconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      className="concept-icon"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function InsideConcept({
  initialScreen = "products",
}: {
  readonly initialScreen?: Screen;
}) {
  const laboratoryHref = new URL(
    "/iframe.html?id=prototypes-design-lab--overview&viewMode=story",
    window.location.href,
  ).href;
  const returnFocus = useRef<HTMLElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [savedBodies, setSavedBodies] = useState<Record<number, string>>({});
  const [materials, setMaterials] = useState(startingMaterials);
  const [createTarget, setCreateTarget] = useState("product");
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [productIndex, setProductIndex] = useState(0);
  const [section, setSection] = useState("Материалы");
  const [filter, setFilter] = useState("Все");
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [products, setProducts] = useState(startingProducts);
  const [title, setTitle] = useState(materials[0]?.title ?? "");
  const [savedTitle, setSavedTitle] = useState(title);
  const [body, setBody] = useState(initialBody);
  const [savedBody, setSavedBody] = useState(body);
  const [savedNotice, setSavedNotice] = useState("");
  const product = products[productIndex] ?? startingProducts[0];
  const material = materials[selectedMaterial] ?? materials[0];
  const chapters = [
    ...new Set(
      materials
        .filter((item) => item.products.includes(productIndex))
        .map((item) => item.chapter),
    ),
  ];
  const inProduct =
    screen === "product" || screen === "editor" || screen === "preview";
  const navScreen = inProduct ? "products" : screen;
  const dirty = title !== savedTitle || body !== savedBody;
  function go(next: Screen) {
    setScreen(next);
    setSavedNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function rememberFocus() {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (returnFocus.current?.isConnected === true) returnFocus.current.focus();
    else document.getElementById("concept-content")?.focus();
  }
  function openProduct(index: number) {
    setProductIndex(index);
    setSection("Материалы");
    setCollapsed([]);
    go("product");
  }
  function openMaterial(index: number) {
    const name = materials[index]?.title ?? "Материал";
    if (materials[index]?.products.includes(productIndex) !== true)
      setProductIndex(materials[index]?.products[0] ?? 0);
    if (index !== selectedMaterial) {
      const nextBody = savedBodies[index] ?? initialBody;
      setBody(nextBody);
      setSavedBody(nextBody);
    }
    setSelectedMaterial(index);
    setTitle(name);
    setSavedTitle(name);
    setSearchOpen(false);
    go("editor");
  }
  function renderMaterial(index: number) {
    const item = materials[index];
    if (item === undefined) return null;
    return (
      <button
        type="button"
        className="concept-material"
        key={item.title}
        onClick={() => {
          openMaterial(index);
        }}
      >
        <span
          className={`concept-material-icon${item.type === "Видео" ? " is-video" : ""}`}
        >
          {item.type === "Видео" ? (
            <Play size={17} aria-hidden="true" />
          ) : (
            <FileText size={18} aria-hidden="true" />
          )}
        </span>
        <span className="concept-material-copy">
          <strong>{item.title}</strong>
          <small>
            {item.type}
            <span>·</span>
            {item.duration}
            {item.products.length > 1 ? (
              <>
                <span>·</span>В двух продуктах
              </>
            ) : null}
          </small>
        </span>
        {item.published ? (
          <Check
            className="concept-material-status"
            size={15}
            aria-label="Опубликован"
          />
        ) : (
          <span className="concept-draft">Черновик</span>
        )}
        <ChevronRight
          className="concept-row-arrow"
          size={16}
          aria-hidden="true"
        />
      </button>
    );
  }
  function renderPeople() {
    return (
      <div className="concept-people">
        {people.map((person) => (
          <div className="concept-person" key={person.name}>
            <span className="concept-avatar">{person.initials}</span>
            <div>
              <strong>{person.name}</strong>
              <p>{person.detail}</p>
            </div>
            <span className="concept-access-state">{person.access}</span>
          </div>
        ))}
        <p className="concept-muted concept-small">
          Демонстрационные участники. Реальные права не меняются.
        </p>
      </div>
    );
  }
  return (
    <div className="inside-concept" lang="ru">
      <a className="concept-skip" href="#concept-content">
        К содержимому
      </a>
      <aside className="concept-sidebar">
        <button
          type="button"
          className="concept-brand"
          onClick={() => {
            go("products");
          }}
        >
          <span className="concept-logo">
            <Layers size={20} aria-hidden="true" />
          </span>
          <strong>Inside</strong>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="concept-sidebar-search"
          onClick={() => {
            rememberFocus();
            setSearchOpen(true);
          }}
        >
          <Search size={17} aria-hidden="true" />
          Поиск в рабочей области
        </button>
        <nav aria-label="Рабочая область">
          {navItems.map(({ screen: destination, label, icon: Icon }) => (
            <button
              type="button"
              key={destination}
              aria-current={navScreen === destination ? "page" : undefined}
              onClick={() => {
                go(destination);
              }}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="concept-pinned">
          <p>Закреплено</p>
          {products.slice(0, 2).map((item, index) => (
            <button
              key={item.name}
              type="button"
              aria-current={
                inProduct && productIndex === index ? "page" : undefined
              }
              onClick={() => {
                openProduct(index);
              }}
            >
              <span className="concept-project-dot" />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
        <div className="concept-sidebar-bottom">
          <a href={laboratoryHref}>
            <ArrowLeft size={16} aria-hidden="true" />К лаборатории
          </a>
          <button
            type="button"
            className="concept-account"
            onClick={() => {
              go("profile");
            }}
          >
            <span className="concept-avatar">К</span>
            <span>
              <strong>Кирилл Сачков</strong>
              <small>Рабочая область автора</small>
            </span>
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </div>
      </aside>
      <div className="concept-main">
        <header className="concept-topbar">
          <div className="concept-mobile-identity">
            {inProduct ? (
              <IconButton
                label="К продуктам"
                onClick={() => {
                  go("products");
                }}
              >
                <ArrowLeft size={21} />
              </IconButton>
            ) : (
              <span className="concept-logo">
                <Layers size={19} aria-hidden="true" />
              </span>
            )}
            <strong>Inside</strong>
          </div>
          <nav className="concept-breadcrumb" aria-label="Путь страницы">
            <button
              type="button"
              onClick={() => {
                go("products");
              }}
            >
              Рабочая область
            </button>
            <ChevronRight size={14} aria-hidden="true" />
            <span>
              {inProduct
                ? product?.name
                : navItems.find((item) => item.screen === screen)?.label}
            </span>
          </nav>
          <div className="concept-top-actions">
            <span className="concept-prototype-label">Прототип</span>
            <IconButton
              label="Найти материал"
              onClick={() => {
                rememberFocus();
                setSearchOpen(true);
              }}
            >
              <Search size={20} />
            </IconButton>
            <button
              type="button"
              className="concept-avatar concept-avatar-button"
              aria-label="Открыть профиль"
              onClick={() => {
                go("profile");
              }}
            >
              К
            </button>
          </div>
        </header>
        <main id="concept-content" className="concept-content" tabIndex={-1}>
          {screen === "products" ? (
            <>
              <div className="concept-page-heading">
                <div>
                  <h1>Продукты</h1>
                  <p>Ваши знания, собранные в систему.</p>
                </div>
                <Button
                  className="concept-button concept-create-desktop"
                  onClick={() => {
                    setCreateTarget("product");
                    rememberFocus();
                    setCreateOpen(true);
                  }}
                >
                  <Plus size={17} />
                  Создать продукт
                </Button>
                <IconButton
                  label="Создать продукт"
                  onClick={() => {
                    setCreateTarget("product");
                    rememberFocus();
                    setCreateOpen(true);
                  }}
                >
                  <Plus size={21} />
                </IconButton>
              </div>
              <div
                className="concept-filters"
                role="group"
                aria-label="Фильтр продуктов"
              >
                {["Все", "Опубликованные", "Черновики"].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                    }}
                  >
                    {value}
                    {value === "Все" ? <span>{products.length}</span> : null}
                  </button>
                ))}
              </div>
              <div className="concept-product-grid">
                {products.map((item, index) =>
                  (filter === "Черновики" && item.state !== "Черновик") ||
                  (filter === "Опубликованные" &&
                    item.state !== "Опубликован") ? null : (
                    <button
                      type="button"
                      className="concept-product-card"
                      key={`${item.name}-${String(index)}`}
                      onClick={() => {
                        openProduct(index);
                      }}
                    >
                      <div className="concept-cover">
                        <picture>
                          <img
                            src={item.cover}
                            alt=""
                            width={960}
                            height={540}
                          />
                        </picture>
                        <span className="concept-cover-action">
                          <ArrowUpRight size={18} aria-hidden="true" />
                        </span>
                      </div>
                      <div className="concept-product-copy">
                        <div className="concept-product-meta">
                          <span>
                            {item.state === "Черновик" ? (
                              <Circle size={11} aria-hidden="true" />
                            ) : (
                              <Check size={13} aria-hidden="true" />
                            )}
                            {item.state}
                          </span>
                          <span>{item.count} материалов</span>
                        </div>
                        <h2>{item.name}</h2>
                        <p>{item.description}</p>
                      </div>
                    </button>
                  ),
                )}
              </div>
              <section className="concept-recent">
                <div className="concept-section-heading">
                  <h2>Недавно открывали</h2>
                  <Button
                    variant="ghost"
                    className="concept-text-button"
                    onClick={() => {
                      go("materials");
                    }}
                  >
                    Все материалы
                    <ArrowRight size={15} />
                  </Button>
                </div>
                {[0, 3, 2].map((index) => renderMaterial(index))}
              </section>
            </>
          ) : null}
          {screen === "product" ? (
            <>
              <div className="concept-product-header">
                <span className="concept-product-symbol">
                  <BookOpen size={27} aria-hidden="true" />
                </span>
                <div className="concept-product-heading-copy">
                  <h1>{product?.name}</h1>
                  <p>{product?.description}</p>
                  <div className="concept-title-meta">
                    <span className="concept-status-dot" />
                    {product?.state}
                    <span>·</span>
                    {product?.count} материалов<span>·</span>
                    {chapters.length} главы
                  </div>
                </div>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="ghost"
                      className="concept-icon"
                      aria-label="Действия с продуктом"
                    >
                      <MoreHorizontal size={22} />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="concept-menu"
                      sideOffset={6}
                    >
                      <DropdownMenu.Item
                        onSelect={() => {
                          setSection("О продукте");
                        }}
                      >
                        О продукте
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() => {
                          setSection("Доступ");
                        }}
                      >
                        Настройки доступа
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() => {
                          go("products");
                        }}
                      >
                        Все продукты
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              <div className="concept-product-actions">
                <Button
                  className="concept-button"
                  onClick={() => {
                    openMaterial(0);
                    setScreen("preview");
                  }}
                >
                  <Play size={15} />
                  Открыть Preview
                </Button>
                <Button
                  variant="ghost"
                  className="concept-button concept-button-muted"
                  onClick={() => {
                    setSection("О продукте");
                  }}
                >
                  <Settings2 size={16} />
                  Настройки
                </Button>
              </div>
              <nav
                className="concept-product-tabs"
                aria-label="Разделы продукта"
              >
                {["Материалы", "Участники", "Доступ"].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-current={section === value ? "page" : undefined}
                    onClick={() => {
                      setSection(value);
                    }}
                  >
                    {value}
                    {value === "Материалы" ? (
                      <span>{product?.count}</span>
                    ) : null}
                  </button>
                ))}
              </nav>
              <div className="concept-product-layout">
                <section className="concept-product-body">
                  {section === "Материалы" ? (
                    <>
                      <div className="concept-section-heading">
                        <h2>Программа</h2>
                        <IconButton
                          label="Добавить материал"
                          onClick={() => {
                            setCreateTarget("material");
                            rememberFocus();
                            setCreateOpen(true);
                          }}
                        >
                          <Plus size={20} />
                        </IconButton>
                      </div>
                      {chapters.length === 0 ? (
                        <p className="concept-inset-note">
                          Программа пока пуста. Нажмите «Добавить материал»,
                          чтобы начать.
                        </p>
                      ) : null}
                      {chapters.map((chapter) => (
                        <section className="concept-chapter" key={chapter}>
                          <button
                            type="button"
                            className="concept-chapter-toggle"
                            aria-expanded={!collapsed.includes(chapter)}
                            onClick={() => {
                              setCollapsed(
                                collapsed.includes(chapter)
                                  ? collapsed.filter(
                                      (value) => value !== chapter,
                                    )
                                  : [...collapsed, chapter],
                              );
                            }}
                          >
                            <ChevronDown size={15} aria-hidden="true" />
                            <span className="concept-chapter-index">
                              {chapter}
                            </span>
                            <h3>
                              {chapter === 1
                                ? "От задачи к решению"
                                : "Надёжность и первый релиз"}
                            </h3>
                            <span>
                              {
                                materials.filter(
                                  (item) =>
                                    item.chapter === chapter &&
                                    item.products.includes(productIndex),
                                ).length
                              }
                            </span>
                          </button>
                          {collapsed.includes(chapter)
                            ? null
                            : materials.map((item, index) =>
                                item.chapter === chapter &&
                                item.products.includes(productIndex)
                                  ? renderMaterial(index)
                                  : null,
                              )}
                        </section>
                      ))}
                    </>
                  ) : section === "Участники" ? (
                    <>
                      <div className="concept-section-heading">
                        <h2>Участники продукта</h2>
                        <span className="concept-muted">{people.length}</span>
                      </div>
                      {renderPeople()}
                    </>
                  ) : section === "Доступ" ? (
                    <>
                      <h2>Доступ к продукту</h2>
                      <div className="concept-setting">
                        <span className="concept-setting-icon">
                          <KeyRound size={20} />
                        </span>
                        <div>
                          <h3>Материалы продукта</h3>
                          <p>
                            Открываются участникам с действующим правом на этот
                            продукт.
                          </p>
                        </div>
                      </div>
                      <div className="concept-setting">
                        <span className="concept-setting-icon">
                          <Users size={20} />
                        </span>
                        <div>
                          <h3>Сообщество продукта</h3>
                          <p>
                            Telegram · подключение и вступление через онбординг
                            продукта.
                          </p>
                        </div>
                      </div>
                      <p className="concept-inset-note">
                        Один материал может входить в несколько продуктов.
                        Доступ к нему не даёт права на другой продукт.
                      </p>
                    </>
                  ) : (
                    <>
                      <h2>О продукте</h2>
                      <label className="concept-field">
                        Название
                        <input value={product?.name ?? ""} readOnly />
                      </label>
                      <label className="concept-field">
                        Описание
                        <textarea value={product?.description ?? ""} readOnly />
                      </label>
                      <p className="concept-muted">
                        В этом прототипе настройки доступны для просмотра.
                      </p>
                    </>
                  )}
                </section>
                <aside className="concept-detail-rail">
                  <h2>О продукте</h2>
                  <p>{product?.description}</p>
                  <dl>
                    <div>
                      <dt>Автор</dt>
                      <dd>Кирилл Сачков</dd>
                    </div>
                    <div>
                      <dt>Состояние</dt>
                      <dd>{product?.state}</dd>
                    </div>
                    <div>
                      <dt>Состав</dt>
                      <dd>{chapters.length} главы</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    onClick={() => {
                      go("materials");
                    }}
                  >
                    <BookOpen size={17} />
                    <span>Общие материалы</span>
                    <ArrowUpRight size={16} />
                  </button>
                  <p className="concept-small concept-muted">
                    Используйте один материал в нескольких продуктах.
                  </p>
                </aside>
              </div>
            </>
          ) : null}
          {screen === "materials" ? (
            <>
              <div className="concept-page-heading">
                <div>
                  <h1>Материалы</h1>
                  <p>Все ваши материалы в одном месте.</p>
                </div>
                <IconButton
                  label="Поиск материалов"
                  onClick={() => {
                    rememberFocus();
                    setSearchOpen(true);
                  }}
                >
                  <Search size={21} />
                </IconButton>
              </div>
              <label className="concept-filter-select">
                Продукт
                <select
                  value={productIndex}
                  onChange={(event) => {
                    setProductIndex(Number(event.target.value));
                  }}
                >
                  <option value="-1">Все продукты</option>
                  {products.map((item, index) => (
                    <option value={index} key={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="concept-all-materials">
                {materials.map((item, index) =>
                  productIndex === -1 || item.products.includes(productIndex)
                    ? renderMaterial(index)
                    : null,
                )}
              </div>
            </>
          ) : null}
          {screen === "people" ? (
            <>
              <div className="concept-page-heading">
                <div>
                  <h1>Участники</h1>
                  <p>Люди, которые учатся в ваших продуктах.</p>
                </div>
              </div>
              {renderPeople()}
            </>
          ) : null}
          {screen === "editor" || screen === "preview" ? (
            <article className="concept-document">
              <div className="concept-document-tools">
                <button
                  type="button"
                  className="concept-back"
                  onClick={() => {
                    go("product");
                  }}
                >
                  <ArrowLeft size={17} />
                  <span>К программе</span>
                </button>
                <span className="concept-editor-mode">
                  {screen === "preview"
                    ? "Авторский Preview"
                    : "Редактирование"}
                </span>
                <Button
                  variant={dirty ? "default" : "secondary"}
                  className="concept-button"
                  onClick={() => {
                    if (screen === "preview") go("editor");
                    else {
                      setSavedTitle(title);
                      setSavedBody(body);
                      setSavedBodies({
                        ...savedBodies,
                        [selectedMaterial]: body,
                      });
                      setMaterials(
                        materials.map((item, index) =>
                          index === selectedMaterial
                            ? { ...item, title }
                            : item,
                        ),
                      );
                      setSavedNotice("Сохранено в примере");
                    }
                  }}
                >
                  {screen === "preview"
                    ? "Редактировать"
                    : dirty
                      ? "Сохранить"
                      : "Сохранено"}
                </Button>
              </div>
              <div className="concept-document-meta">
                {material?.type}
                <span>·</span>
                {material?.duration}
                <span>·</span>
                {material?.published === true ? "Опубликован" : "Черновик"}
              </div>
              {screen === "editor" ? (
                <>
                  <label className="concept-editor-title">
                    <span className="sr-only">Название материала</span>
                    <textarea
                      value={title}
                      rows={2}
                      onChange={(event) => {
                        setTitle(event.target.value);
                      }}
                    />
                  </label>
                  <label className="concept-editor-body">
                    <span className="sr-only">Текст материала</span>
                    <textarea
                      value={body}
                      onChange={(event) => {
                        setBody(event.target.value);
                      }}
                    />
                  </label>
                  <div className="concept-document-bottom">
                    <p role="status">
                      {dirty
                        ? "Есть несохранённые изменения"
                        : savedNotice.length > 0
                          ? savedNotice
                          : "Все изменения сохранены в примере"}
                    </p>
                    <Button
                      variant="ghost"
                      className="concept-button"
                      onClick={() => {
                        go("preview");
                      }}
                    >
                      Preview
                      <ExternalLink size={15} />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h1>{savedTitle}</h1>
                  {savedBody.split("\n\n").map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  <div className="concept-reading-callout">
                    <h2>Начните с одного вопроса</h2>
                    <p>Как человек поймёт, что его задача решена?</p>
                  </div>
                  <p className="concept-small concept-muted">
                    Preview показывает сохранённое состояние. Публикация не
                    выполняется.
                  </p>
                </>
              )}
            </article>
          ) : null}
          {screen === "profile" ? (
            <>
              <div className="concept-page-heading">
                <div>
                  <h1>Рабочая область</h1>
                  <p>Кирилл Сачков · автор</p>
                </div>
              </div>
              <div className="concept-profile-note">
                <Layers size={24} />
                <div>
                  <h2>Inside · цельный дизайн</h2>
                  <p>
                    Мобильная навигация, работа в контексте продукта и спокойное
                    оформление. Данные демонстрационные; изменения живут в
                    памяти.
                  </p>
                </div>
              </div>
              <h2>Из чего собран подход</h2>
              <div className="concept-reference-list">
                {references.map((item) => (
                  <a
                    key={item.name}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <ArrowUpRight size={18} />
                  </a>
                ))}
              </div>
              <a className="concept-back" href={laboratoryHref}>
                <ArrowLeft size={17} />К сравнению вариантов
              </a>
            </>
          ) : null}
          <footer className="concept-proof-footer">
            Inside · демонстрационный дизайн для просмотра
          </footer>
        </main>
      </div>
      <nav className="concept-mobile-nav" aria-label="Основная навигация">
        {navItems.map(({ screen: destination, label, icon: Icon }) => (
          <button
            type="button"
            key={destination}
            aria-current={navScreen === destination ? "page" : undefined}
            onClick={() => {
              go(destination);
            }}
          >
            <span>
              <Icon size={21} aria-hidden="true" />
            </span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
      <Dialog.Root open={searchOpen} onOpenChange={setSearchOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="concept-dialog-overlay" />
          <Dialog.Content
            className="concept-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchInput.current?.focus();
            }}
            onCloseAutoFocus={restoreFocus}
          >
            <div className="concept-dialog-heading">
              <Dialog.Title>Найти материал</Dialog.Title>
              <Dialog.Close asChild>
                <IconButton label="Закрыть поиск">
                  <X size={20} />
                </IconButton>
              </Dialog.Close>
            </div>
            <Dialog.Description className="concept-muted">
              Поиск по демонстрационным материалам.
            </Dialog.Description>
            <label className="concept-search-field">
              <Search size={20} />
              <input
                autoComplete="off"
                ref={searchInput}
                aria-label="Название материала для поиска"
                placeholder="Название или часть названия"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </label>
            <div className="concept-search-results">
              {materials.map((item, index) =>
                item.title.toLowerCase().includes(query.toLowerCase())
                  ? renderMaterial(index)
                  : null,
              )}
              {materials.some((item) =>
                item.title.toLowerCase().includes(query.toLowerCase()),
              ) ? null : (
                <p className="concept-inset-note">
                  Ничего не найдено. Попробуйте другое название.
                </p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="concept-dialog-overlay" />
          <Dialog.Content
            className="concept-dialog concept-create-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              nameInput.current?.focus();
            }}
            onCloseAutoFocus={restoreFocus}
          >
            <div className="concept-dialog-heading">
              <Dialog.Title>
                {createTarget === "product"
                  ? "Новый продукт"
                  : "Новый материал"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <IconButton label="Закрыть создание продукта">
                  <X size={20} />
                </IconButton>
              </Dialog.Close>
            </div>
            <Dialog.Description className="concept-muted">
              {createTarget === "product"
                ? "Соберите материалы вокруг одной задачи ученика."
                : "Добавьте материал в программу продукта."}
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (newName.trim().length === 0) return;
                if (createTarget === "product") {
                  setProducts([
                    ...products,
                    {
                      name: newName.trim(),
                      description:
                        "Новый продукт. Добавьте описание и первые материалы.",
                      cover: architectureCover,
                      state: "Черновик",
                      count: 0,
                    },
                  ]);
                  go("products");
                  setFilter("Все");
                } else {
                  const nextIndex = materials.length;
                  setMaterials([
                    ...materials,
                    {
                      title: newName.trim(),
                      type: "Гайд",
                      duration: "0 мин",
                      published: false,
                      chapter: 1,
                      products: [Math.max(0, productIndex)],
                    },
                  ]);
                  setProducts(
                    products.map((item, index) =>
                      index === productIndex
                        ? { ...item, count: item.count + 1 }
                        : item,
                    ),
                  );
                  setSavedBodies({ ...savedBodies, [nextIndex]: "" });
                  setSelectedMaterial(nextIndex);
                  setTitle(newName.trim());
                  setSavedTitle(newName.trim());
                  setBody("");
                  setSavedBody("");
                  go("editor");
                }
                setNewName("");
                setCreateOpen(false);
              }}
            >
              <label className="concept-field">
                Название
                <input
                  required
                  ref={nameInput}
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value);
                  }}
                  placeholder="Например, первый релиз"
                />
              </label>
              <Button type="submit" className="concept-button">
                {createTarget === "product"
                  ? "Создать продукт"
                  : "Создать материал"}
                <ArrowRight size={16} />
              </Button>
              <p className="concept-small concept-muted">
                Создание имитируется. Продукт не публикуется.
              </p>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
