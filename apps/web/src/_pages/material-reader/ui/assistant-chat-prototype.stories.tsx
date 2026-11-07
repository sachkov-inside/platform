/**
 * PROTOTYPE, не для main. Тикет «Помощник: дизайн чата на сайте» (#1979).
 *
 * Вопрос: как выглядит и ведёт себя чат Помощника на сайте. Три варианта на настоящей странице
 * материала: A «Панель справа», B «Окно поверх», C «Строка внизу». У каждого есть версия для
 * телефона. Разговор лежит в памяти модуля, как будто на сервере: он переживает переходы между
 * страницами, кнопку «Перезагрузить» и переключение вариантов. Ответы Помощника заготовлены;
 * модели, сети и production-модулей чата нет.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  FileText,
  Info,
  ListChecks,
  LockKeyhole,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  Minus,
  PanelRightClose,
  Play,
  Quote,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { ReadingProgressProvider } from "@/features/reading-progress";
import { cn } from "@/shared/lib/utils";
import { publicPageEnvironment } from "@/storybook/story-environment";

import ReaderMeta from "./material-reader.stories";
import { MaterialReaderView } from "./material-reader-view";

/* ------------------------------------------------------------------ */
/* Данные                                                              */
/* ------------------------------------------------------------------ */

type Variant = "panel" | "window" | "bar";

type PageKey = "skills" | "one-source" | "programme";

const pages: Record<
  PageKey,
  { readonly title: string; readonly label: string }
> = {
  skills: {
    title: "Публичные skills для agent-first setup",
    label: "Материал",
  },
  "one-source": {
    title: "Правило одного источника",
    label: "Другой материал",
  },
  programme: { title: "Создание Platform Inside", label: "Программа курса" },
};

const course = "Создание Platform Inside";

interface Source {
  readonly title: string;
  readonly where: string;
  readonly page?: PageKey;
  readonly locked?: boolean;
}

type Segment = string | { readonly text: string; readonly page: PageKey };

type ScenarioKey = "start" | "paid" | "mcp";

interface ScenarioStep {
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly result: string;
}

const scenarios: Record<
  ScenarioKey,
  {
    readonly title: string;
    readonly steps: readonly ScenarioStep[];
    readonly outcome: string;
  }
> = {
  start: {
    title: "С чего начать курс",
    steps: [
      {
        title: "Прочитайте «Как устроен курс»",
        body: "5 минут. Там порядок уроков и то, как сдавать задания.",
        action: "Я прочитал",
        result: "Прочитано",
      },
      {
        title: "Подключите учебный MCP",
        body: "Ваш агент сможет читать материалы курса и сдавать задания.",
        action: "Подключено",
        result: "Агент подключён",
      },
      {
        title: "Вступите в группу курса",
        body: "Там отвечают автор и другие ученики.",
        action: "Открыть группу в Telegram",
        result: "Группа открыта",
      },
    ],
    outcome: "Готово. Следующий урок: «Выбор агента и модели».",
  },
  paid: {
    title: "Оплатил, но нет доступа",
    steps: [
      {
        title: "Проверим оплату",
        body: "Помощник найдёт платёж по вашему аккаунту. Данные карты он не видит.",
        action: "Проверить",
        result: "Платёж от 3 ноября найден: «Создание Platform Inside».",
      },
      {
        title: "Проверим аккаунт",
        body: "Сейчас вы вошли как kirill@example.com. Доступ выдан этому аккаунту.",
        action: "Это мой аккаунт",
        result: "Аккаунт совпадает. Обновите страницу курса.",
      },
    ],
    outcome:
      "Доступ открыт. Если курс всё ещё закрыт, напишите автору в личные сообщения.",
  },
  mcp: {
    title: "Подключить учебный MCP",
    steps: [
      {
        title: "Скопируйте адрес",
        body: "https://inside.example/mcp/learner",
        action: "Скопировать адрес",
        result: "Адрес скопирован",
      },
      {
        title: "Добавьте адрес в агент",
        body: "Claude Code, Codex или Cursor: раздел MCP в настройках.",
        action: "Добавил",
        result: "Добавлено",
      },
      {
        title: "Проверьте подключение",
        body: "Помощник посмотрит, обращался ли ваш агент к MCP.",
        action: "Проверить",
        result: "Агент подключился в 12:04.",
      },
    ],
    outcome: "Учебный MCP работает.",
  },
};

type Message =
  | { readonly id: string; readonly role: "day"; readonly label: string }
  | {
      readonly id: string;
      readonly role: "user";
      readonly text: string;
      readonly about?: string;
      readonly quote?: string;
    }
  | {
      readonly id: string;
      readonly role: "assistant";
      readonly text: readonly Segment[];
      readonly sources?: readonly Source[];
      readonly offer?: ScenarioKey;
      readonly handoff?: string;
      readonly rating?: "up" | "down";
      readonly comment?: string;
      readonly commentSent?: boolean;
    }
  | {
      readonly id: string;
      readonly role: "scenario";
      readonly key: ScenarioKey;
      readonly step: number;
      readonly stopped?: boolean;
    };

const history: readonly Message[] = [
  { id: "d1", role: "day", label: "Вчера" },
  { id: "u1", role: "user", text: "С чего начать курс?" },
  {
    id: "a1",
    role: "assistant",
    text: ["У курса есть короткий маршрут для первого дня. Это три шага."],
    offer: "start",
    rating: "up",
  },
  { id: "s1", role: "scenario", key: "start", step: 3 },
  { id: "d2", role: "day", label: "Сегодня" },
  {
    id: "u2",
    role: "user",
    about: pages.skills.title,
    text: "Чем skill отличается от project rules?",
  },
  {
    id: "a2",
    role: "assistant",
    text: [
      "Project rules описывают постоянные правила проекта. Skill описывает один повторяемый процесс с проверяемым результатом и дополняет правила, но не отменяет их. Подробнее в разделе «Сначала найдите устойчивый seam» и в материале ",
      { text: "«Правило одного источника»", page: "one-source" },
      ".",
    ],
    sources: [
      {
        title: pages.skills.title,
        where: "Раздел «Сначала найдите устойчивый seam»",
        page: "skills",
      },
      {
        title: pages["one-source"].title,
        where: `Курс «${course}», урок 6`,
        page: "one-source",
      },
    ],
  },
  { id: "u3", role: "user", text: "А как настроить деплой в Kubernetes?" },
  {
    id: "a3",
    role: "assistant",
    text: [
      "В курсе этого нет. Ближе всего урок о проверках и CI: там настраивается сборка, но не деплой.",
    ],
    sources: [
      {
        title: "Настройка тестов, проверок архитектуры и CI",
        where: `Курс «${course}», урок 12`,
        page: "programme",
      },
      {
        title: "Production для AI-продуктов",
        where: "Тема есть в этом курсе. У вас нет к нему доступа",
        locked: true,
        page: "programme",
      },
    ],
  },
  { id: "u4", role: "user", text: "Можно обсудить мой проект с автором?" },
  {
    id: "a4",
    role: "assistant",
    text: [
      "Разбор проекта лучше обсудить с людьми. В группе курса отвечают автор и другие ученики. Ваш разговор со мной туда не попадёт: опишите вопрос сами.",
    ],
    handoff: "Открыть группу курса в Telegram",
  },
];

/* Память модуля играет роль сервера и браузера: переживает «перезагрузку» и смену варианта. */
const server = { messages: [...history] as Message[] };
const browser: { open: boolean; page: PageKey; noticeSeen: boolean } = {
  open: true,
  page: "skills",
  noticeSeen: false,
};

let nextId = 100;
const newId = () => `m${nextId++}`;

function cannedReply(text: string, page: PageKey): Message {
  const lower = text.toLowerCase();
  if (/(оплат|доступ|купил)/.test(lower))
    return {
      id: newId(),
      role: "assistant",
      text: [
        "Это проверяет готовый сценарий: он посмотрит платёж и аккаунт. Запустить?",
      ],
      offer: "paid",
    };
  if (/mcp/.test(lower))
    return {
      id: newId(),
      role: "assistant",
      text: ["Подключение занимает три шага. Запустить сценарий?"],
      offer: "mcp",
    };
  const here = page === "programme" ? "skills" : page;
  return {
    id: newId(),
    role: "assistant",
    text: [
      "Об этом сказано в материале ",
      { text: `«${pages[here].title}»`, page: here },
      ": сначала запишите вход, проверяемый результат и границу ответственности, а уже потом оформляйте skill.",
    ],
    sources: [
      {
        title: pages[here].title,
        where: "Раздел «Сначала найдите устойчивый seam»",
        page: here,
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Состояние чата                                                      */
/* ------------------------------------------------------------------ */

interface Context {
  readonly about?: string;
  readonly quote?: string;
}

function useChat(page: PageKey) {
  const [messages, setMessages] = useState<Message[]>(server.messages);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    server.messages = messages;
  }, [messages]);

  const update = (id: string, patch: Partial<Message>) =>
    setMessages((all) =>
      all.map((m) => (m.id === id ? ({ ...m, ...patch } as Message) : m)),
    );

  const send = (text: string, context: Context) => {
    if (text.trim() === "") return;
    setMessages((all) => [
      ...all,
      { id: newId(), role: "user", text: text.trim(), ...context },
    ]);
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      setMessages((all) => [...all, cannedReply(text, page)]);
    }, 900);
  };

  const launch = (key: ScenarioKey) =>
    setMessages((all) => [
      ...all,
      { id: newId(), role: "user", text: scenarios[key].title },
      { id: newId(), role: "scenario", key, step: 0 },
    ]);

  return { messages, typing, update, send, launch };
}

type Chat = ReturnType<typeof useChat>;

function useWide() {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const on = () => setWide(list.matches);
    list.addEventListener("change", on);
    return () => list.removeEventListener("change", on);
  }, []);
  return wide;
}

function useHeaderBottom() {
  const [bottom, setBottom] = useState(80);
  useLayoutEffect(() => {
    const header = document.querySelector("header");
    if (header) setBottom(Math.round(header.getBoundingClientRect().bottom));
  }, []);
  return bottom;
}

/* ------------------------------------------------------------------ */
/* Общие части чата                                                    */
/* ------------------------------------------------------------------ */

interface Style {
  readonly sources: "cards" | "numbered" | "chips";
  readonly rating: "words" | "thumbs";
  readonly notice: "footer" | "card" | "info";
}

const styles: Record<Variant, Style> = {
  panel: { sources: "cards", rating: "words", notice: "footer" },
  window: { sources: "numbered", rating: "thumbs", notice: "card" },
  bar: { sources: "chips", rating: "words", notice: "info" },
};

const noticeText =
  "Автор курса читает разговоры с Помощником, чтобы улучшать ответы. Не пишите сюда пароли и платёжные данные.";

const quickStarts: readonly ScenarioKey[] = ["start", "paid", "mcp"];

function Conversation({
  chat,
  style,
  navigate,
  compact = false,
}: {
  readonly chat: Chat;
  readonly style: Style;
  readonly navigate: (page: PageKey) => void;
  readonly compact?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [noticeSeen, setNoticeSeen] = useState(browser.noticeSeen);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.typing]);

  const empty = chat.messages.length === 0;
  return (
    <div
      ref={scroller}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4",
        compact && "gap-3",
      )}
    >
      {style.notice === "card" && !noticeSeen ? (
        <div className="rounded-xl border border-border bg-muted/60 p-3 text-sm leading-6">
          <p className="m-0 flex gap-2">
            <Info className="mt-1 size-4 shrink-0 text-muted-foreground" />
            {noticeText}
          </p>
          <button
            type="button"
            className="mt-2 ml-6 text-sm font-semibold text-foreground underline underline-offset-4"
            onClick={() => {
              browser.noticeSeen = true;
              setNoticeSeen(true);
            }}
          >
            Понятно
          </button>
        </div>
      ) : null}
      {empty ? (
        <EmptyState chat={chat} showNotice={style.notice === "info"} />
      ) : null}
      {chat.messages.map((m) => (
        <MessageView
          key={m.id}
          chat={chat}
          message={m}
          navigate={navigate}
          style={style}
        />
      ))}
      {chat.typing ? (
        <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4 animate-pulse text-accent" />
          Ищу в материалах курса…
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({
  chat,
  showNotice,
}: {
  readonly chat: Chat;
  readonly showNotice: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="m-0 text-base leading-7">
        Здравствуйте. Я отвечаю на вопросы по материалам курсов Inside и даю
        ссылку на нужный урок.
      </p>
      {showNotice ? (
        <p className="m-0 flex gap-2 text-sm leading-6 text-muted-foreground">
          <Info className="mt-1 size-4 shrink-0" />
          {noticeText}
        </p>
      ) : null}
      <p className="m-0 text-sm font-semibold">Частые вопросы</p>
      <div className="flex flex-wrap gap-2">
        {quickStarts.map((key) => (
          <ScenarioChip key={key} chat={chat} scenario={key} />
        ))}
      </div>
    </div>
  );
}

function ScenarioChip({
  chat,
  scenario,
}: {
  readonly chat: Chat;
  readonly scenario: ScenarioKey;
}) {
  return (
    <button
      type="button"
      onClick={() => chat.launch(scenario)}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
    >
      <ListChecks className="size-4 text-accent" />
      {scenarios[scenario].title}
    </button>
  );
}

function MessageView({
  chat,
  message: m,
  navigate,
  style,
}: {
  readonly chat: Chat;
  readonly message: Message;
  readonly navigate: (page: PageKey) => void;
  readonly style: Style;
}) {
  if (m.role === "day")
    return (
      <p className="m-0 text-center text-xs font-medium text-muted-foreground">
        {m.label}
      </p>
    );
  if (m.role === "user")
    return (
      <div className="flex flex-col items-end gap-1">
        {m.about ? (
          <span className="inline-flex max-w-[85%] items-center gap-1 text-xs text-muted-foreground">
            <FileText className="size-3.5 shrink-0" />
            <span className="truncate">О материале «{m.about}»</span>
          </span>
        ) : null}
        {m.quote ? (
          <span className="max-w-[85%] border-l-2 border-accent pl-2 text-xs italic text-muted-foreground">
            «{m.quote}»
          </span>
        ) : null}
        <p className="m-0 max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[0.9375rem] leading-6 text-primary-foreground">
          {m.text}
        </p>
      </div>
    );
  if (m.role === "scenario") return <ScenarioCard chat={chat} message={m} />;

  const numbered = style.sources === "numbered" && m.sources;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[0.9375rem] leading-7">
        {m.text.map((s, i) =>
          typeof s === "string" ? (
            <span key={i}>{s}</span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => navigate(s.page)}
              className="font-medium text-accent underline underline-offset-4"
            >
              {s.text}
            </button>
          ),
        )}
        {numbered
          ? m.sources?.map((_, i) => (
              <sup key={i} className="ml-0.5 text-xs font-semibold text-accent">
                [{i + 1}]
              </sup>
            ))
          : null}
      </p>
      {m.sources ? (
        <Sources sources={m.sources} navigate={navigate} kind={style.sources} />
      ) : null}
      {m.offer ? (
        <button
          type="button"
          onClick={() => chat.launch(m.offer!)}
          className="inline-flex min-h-10 items-center gap-2 self-start rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/85"
        >
          <Play className="size-4" />
          Запустить: {scenarios[m.offer].title}
        </button>
      ) : null}
      {m.handoff ? (
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 self-start rounded-xl border border-border bg-background px-3.5 text-sm font-semibold hover:bg-muted"
        >
          <Send className="size-4" />
          {m.handoff}
        </button>
      ) : null}
      <Rating chat={chat} message={m} kind={style.rating} />
    </div>
  );
}

function Sources({
  sources,
  navigate,
  kind,
}: {
  readonly sources: readonly Source[];
  readonly navigate: (page: PageKey) => void;
  readonly kind: Style["sources"];
}) {
  if (kind === "chips")
    return (
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => s.page && navigate(s.page)}
            title={s.where}
            className="inline-flex max-w-full min-h-8 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs font-medium hover:bg-muted"
          >
            {s.locked ? (
              <LockKeyhole className="size-3.5 shrink-0" />
            ) : (
              <BookOpen className="size-3.5 shrink-0 text-accent" />
            )}
            <span className="truncate">{s.title}</span>
          </button>
        ))}
      </div>
    );
  if (kind === "numbered")
    return (
      <ol className="m-0 flex list-none flex-col gap-1 border-t border-border p-0 pt-2 text-sm">
        {sources.map((s, i) => (
          <li key={s.title} className="flex gap-2">
            <span className="text-xs font-semibold leading-6 text-accent">
              [{i + 1}]
            </span>
            <button
              type="button"
              onClick={() => s.page && navigate(s.page)}
              className="text-left leading-6 hover:underline"
            >
              {s.locked ? (
                <LockKeyhole className="mr-1 inline size-3.5" />
              ) : null}
              {s.title}
              <span className="block text-xs text-muted-foreground">
                {s.where}
              </span>
            </button>
          </li>
        ))}
      </ol>
    );
  return (
    <div className="flex flex-col gap-1.5">
      {sources.map((s) => (
        <button
          key={s.title}
          type="button"
          onClick={() => s.page && navigate(s.page)}
          className="flex items-start gap-3 rounded-xl border border-border bg-background p-2.5 text-left hover:bg-muted"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
            {s.locked ? (
              <LockKeyhole className="size-4" />
            ) : (
              <FileText className="size-4 text-accent" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-5">
              {s.title}
            </span>
            <span className="block text-xs leading-5 text-muted-foreground">
              {s.where}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Rating({
  chat,
  message: m,
  kind,
}: {
  readonly chat: Chat;
  readonly message: Extract<Message, { role: "assistant" }>;
  readonly kind: Style["rating"];
}) {
  const [draft, setDraft] = useState(m.comment ?? "");
  if (m.commentSent)
    return (
      <p className="m-0 text-xs text-muted-foreground">
        Спасибо. Автор увидит ваш отзыв.
      </p>
    );
  const button = (value: "up" | "down") => {
    const active = m.rating === value;
    const Icon = value === "up" ? ThumbsUp : ThumbsDown;
    const label = value === "up" ? "Полезно" : "Не помогло";
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={label}
        title={label}
        onClick={() =>
          chat.update(m.id, { rating: active ? undefined : value } as never)
        }
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
          active && "bg-secondary text-foreground",
        )}
      >
        <Icon className={cn("size-3.5", active && "fill-current")} />
        {kind === "words" ? label : null}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="-ml-2 flex items-center gap-1">
        {button("up")}
        {button("down")}
      </div>
      {m.rating === "down" ? (
        <form
          className="flex flex-col gap-2 rounded-xl border border-border bg-background p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            chat.update(m.id, { comment: draft, commentSent: true } as never);
          }}
        >
          <label className="text-xs font-medium" htmlFor={`c-${m.id}`}>
            Что не так? Необязательно
          </label>
          <textarea
            id={`c-${m.id}`}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="resize-none rounded-lg border border-input bg-card px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="Например: ответ не про мой вопрос"
          />
          <button
            type="submit"
            className="self-end rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Отправить
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ScenarioCard({
  chat,
  message: m,
}: {
  readonly chat: Chat;
  readonly message: Extract<Message, { role: "scenario" }>;
}) {
  const def = scenarios[m.key];
  const done = m.step >= def.steps.length;
  return (
    <section
      aria-label={`Сценарий: ${def.title}`}
      className="rounded-2xl border border-border bg-background p-3.5"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="size-4 text-accent" />
          {def.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {m.stopped
            ? "Остановлен"
            : done
              ? "Готово"
              : `Шаг ${m.step + 1} из ${def.steps.length}`}
        </span>
      </header>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {def.steps.map((step, i) => {
          const state =
            i < m.step ? "done" : i === m.step && !m.stopped ? "now" : "later";
          return (
            <li key={step.title} className="flex gap-2.5">
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[0.6875rem] font-semibold",
                  state === "done" &&
                    "border-transparent bg-primary text-primary-foreground",
                  state === "now" && "border-accent text-accent",
                  state === "later" && "border-border text-muted-foreground",
                )}
              >
                {state === "done" ? <Check className="size-3" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "m-0 text-sm leading-6",
                    state === "later" && "text-muted-foreground",
                    state !== "later" && "font-medium",
                  )}
                >
                  {step.title}
                </p>
                {state === "done" ? (
                  <p className="m-0 text-xs text-muted-foreground">
                    {step.result}
                  </p>
                ) : null}
                {state === "now" ? (
                  <div className="mt-1 flex flex-col gap-2">
                    <p className="m-0 text-sm leading-6 text-muted-foreground">
                      {step.body}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => chat.update(m.id, { step: i + 1 })}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                      >
                        {step.action}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          chat.update(m.id, { stopped: true } as never)
                        }
                        className="rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        Остановить
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {done ? (
        <p className="m-0 mt-3 rounded-lg bg-secondary px-3 py-2 text-sm leading-6">
          {def.outcome}
        </p>
      ) : null}
    </section>
  );
}

function Composer({
  chat,
  context,
  setContext,
  placeholder = "Спросите о курсе",
  focusKey,
  rounded = false,
  onFocus,
  footer,
}: {
  readonly chat: Chat;
  readonly context: Context;
  readonly setContext: (c: Context) => void;
  readonly placeholder?: string;
  readonly focusKey?: number;
  readonly rounded?: boolean;
  readonly onFocus?: () => void;
  readonly footer?: ReactNode;
}) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusKey) field.current?.focus();
  }, [focusKey]);
  const submit = () => {
    chat.send(text, context);
    setText("");
    setContext({});
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "flex flex-col gap-1.5 border-t border-border bg-card px-3 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]",
        rounded && "border-t-0",
      )}
    >
      {context.about || context.quote ? (
        <div className="flex">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary py-1 pr-1 pl-2.5 text-xs font-medium">
            {context.quote ? (
              <Quote className="size-3.5 shrink-0" />
            ) : (
              <FileText className="size-3.5 shrink-0 text-accent" />
            )}
            <span className="truncate">
              {context.quote
                ? `«${context.quote}»`
                : `Об этом материале: ${context.about}`}
            </span>
            <button
              type="button"
              aria-label="Убрать отметку"
              onClick={() => setContext({})}
              className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-muted"
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={field}
          rows={1}
          value={text}
          onFocus={onFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-[0.9375rem] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <button
          type="submit"
          aria-label="Отправить"
          disabled={text.trim() === ""}
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
      {footer}
    </form>
  );
}

function ChatTitle({ subtitle }: { readonly subtitle?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="m-0 flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-accent" />
        Помощник Inside
      </p>
      <p className="m-0 truncate text-xs text-muted-foreground">
        {subtitle ?? `Сначала ищет в курсе «${course}»`}
      </p>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Страница под чатом                                                  */
/* ------------------------------------------------------------------ */

const readerArgs = ReaderMeta.args as unknown as ComponentProps<
  typeof MaterialReaderView
>;

function HostPage({
  page,
  topAsk,
  endAsk,
}: {
  readonly page: PageKey;
  readonly topAsk?: ReactNode;
  readonly endAsk?: ReactNode;
}) {
  if (page === "programme")
    return (
      <div className="mx-auto max-w-[43rem] py-6">
        <p className="m-0 text-sm text-muted-foreground">Курс</p>
        <h1 className="mt-1 mb-6 text-3xl font-semibold tracking-tight">
          {course}
        </h1>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {[
            "Как устроен курс",
            "Выбор агента и модели",
            "Подготовка проекта: инструкции, скиллы и репозиторий",
            "Публичные skills для agent-first setup",
            "Правило одного источника",
            "Настройка тестов, проверок архитектуры и CI",
          ].map((t, i) => (
            <li
              key={t}
              className="flex gap-3 rounded-xl border border-border bg-card p-3"
            >
              <span className="text-sm text-muted-foreground">{i + 1}</span>
              <span className="text-sm font-medium">{t}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-muted-foreground">
          Заглушка страницы программы: здесь нет кнопки «Спросить об этом
          материале», но разговор тот же.
        </p>
      </div>
    );
  return (
    <MaterialReaderView
      {...readerArgs}
      key={page}
      material={{ ...readerArgs.material, title: pages[page].title }}
      topBookmarkAction={
        <>
          {readerArgs.topBookmarkAction}
          {topAsk}
        </>
      }
      practiceActions={endAsk}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Вариант A: панель справа                                            */
/* ------------------------------------------------------------------ */

function VariantPanel({
  page,
  navigate,
}: {
  readonly page: PageKey;
  readonly navigate: (p: PageKey) => void;
}) {
  const wide = useWide();
  const top = useHeaderBottom();
  const chat = useChat(page);
  const [open, setOpenState] = useState(browser.open);
  const setOpen = (v: boolean) => {
    browser.open = v;
    setOpenState(v);
  };
  const [context, setContext] = useState<Context>({});
  const [focusKey, setFocusKey] = useState(0);
  const ask = () => {
    setContext({ about: pages[page].title });
    setOpen(true);
    setFocusKey((k) => k + 1);
  };
  const go = (p: PageKey) => {
    if (!wide) setOpen(false);
    navigate(p);
  };

  const askButton =
    page === "programme" ? null : (
      <button
        type="button"
        onClick={ask}
        aria-label="Спросить об этом материале"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-foreground hover:bg-muted"
      >
        <MessageCircleQuestion className="size-5 text-accent" />
        <span className="max-lg:hidden">Спросить об этом материале</span>
      </button>
    );

  const panelBody = (
    <>
      <Conversation chat={chat} style={styles.panel} navigate={go} />
      <Composer
        chat={chat}
        context={context}
        setContext={setContext}
        focusKey={focusKey}
        placeholder={
          page === "programme"
            ? "Спросите о курсе"
            : "Спросите о материале или курсе"
        }
        footer={
          <p className="m-0 text-[0.6875rem] leading-4 text-muted-foreground">
            {noticeText}
          </p>
        }
      />
    </>
  );

  return (
    <>
      <HostPage page={page} topAsk={askButton} />
      {wide ? (
        <>
          <style>{`[data-application-content]{padding-right:${open ? 400 : 52}px;transition:padding .2s}`}</style>
          {open ? (
            <aside
              aria-label="Помощник"
              style={{ top }}
              className="fixed right-0 bottom-0 z-40 flex w-[400px] flex-col border-l border-border bg-card"
            >
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <ChatTitle />
                <IconButton
                  label="Свернуть панель"
                  onClick={() => setOpen(false)}
                >
                  <PanelRightClose className="size-5" />
                </IconButton>
              </div>
              {panelBody}
            </aside>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              style={{ top }}
              className="fixed right-0 bottom-0 z-40 flex w-[52px] flex-col items-center gap-3 border-l border-border bg-card pt-4 text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="size-5 text-accent" />
              <span className="text-sm font-semibold [writing-mode:vertical-rl]">
                Помощник
              </span>
            </button>
          )}
        </>
      ) : open ? (
        <div
          role="dialog"
          aria-label="Помощник"
          className="fixed inset-0 z-50 flex flex-col bg-card"
        >
          <div className="flex items-center gap-1 border-b border-border px-2 py-2">
            <IconButton label="Свернуть" onClick={() => setOpen(false)}>
              <ChevronDown className="size-5" />
            </IconButton>
            <ChatTitle />
          </div>
          {panelBody}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg"
        >
          <Sparkles className="size-5" />
          Помощник
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Вариант B: окно поверх страницы                                     */
/* ------------------------------------------------------------------ */

function VariantWindow({
  page,
  navigate,
}: {
  readonly page: PageKey;
  readonly navigate: (p: PageKey) => void;
}) {
  const wide = useWide();
  const chat = useChat(page);
  const [open, setOpenState] = useState(browser.open);
  const setOpen = (v: boolean) => {
    browser.open = v;
    setOpenState(v);
  };
  const [big, setBig] = useState(false);
  const [context, setContext] = useState<Context>({});
  const [focusKey, setFocusKey] = useState(0);
  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  // Выделенный в материале текст можно спросить отдельной кнопкой у выделения.
  useEffect(() => {
    if (page === "programme") return;
    const onUp = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      const node = s?.anchorNode?.parentElement;
      if (!s || text.length < 3 || !node?.closest("article")) {
        setSelection(null);
        return;
      }
      const rect = s.getRangeAt(0).getBoundingClientRect();
      setSelection({
        text: text.length > 90 ? `${text.slice(0, 90)}…` : text,
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
  }, [page]);

  const openWith = (c: Context) => {
    setContext(c);
    setOpen(true);
    setFocusKey((k) => k + 1);
    setSelection(null);
  };
  const go = (p: PageKey) => {
    if (!wide) setOpen(false);
    navigate(p);
  };

  const endAsk =
    page === "programme" ? null : (
      <div className="mt-10 flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
        <CircleHelp className="size-6 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-semibold">Что-то осталось непонятным?</p>
          <p className="m-0 text-sm text-muted-foreground">
            Помощник ответит по этому материалу и даст ссылку на нужный раздел.
            Можно выделить фразу в тексте и спросить о ней.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openWith({ about: pages[page].title })}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <MessageCircleQuestion className="size-4" />
          Спросить об этом материале
        </button>
      </div>
    );

  const windowBody = (
    <>
      <div className="flex items-center gap-1 border-b border-border py-2 pr-2 pl-4">
        {wide ? null : (
          <IconButton label="Свернуть" onClick={() => setOpen(false)}>
            <ChevronLeft className="size-5" />
          </IconButton>
        )}
        <ChatTitle />
        {wide ? (
          <>
            <IconButton
              label={big ? "Уменьшить окно" : "Увеличить окно"}
              onClick={() => setBig(!big)}
            >
              {big ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </IconButton>
            <IconButton label="Свернуть" onClick={() => setOpen(false)}>
              <Minus className="size-5" />
            </IconButton>
          </>
        ) : null}
      </div>
      <Conversation chat={chat} style={styles.window} navigate={go} compact />
      <Composer
        chat={chat}
        context={context}
        setContext={setContext}
        focusKey={focusKey}
      />
    </>
  );

  return (
    <>
      <HostPage page={page} endAsk={endAsk} />
      {selection && !open ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openWith({ quote: selection.text })}
          style={{ left: selection.x, top: selection.y - 44 }}
          className="fixed z-50 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-lg"
        >
          <MessageCircleQuestion className="size-4" />
          Спросить об этом
        </button>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-label="Помощник"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-card",
            wide
              ? "right-6 bottom-6 rounded-2xl border border-border shadow-2xl"
              : "inset-0",
            wide && !big && "h-[min(640px,calc(100vh-8rem))] w-[400px]",
            wide &&
              big &&
              "h-[calc(100vh-7rem)] w-[min(680px,calc(100vw-3rem))]",
          )}
        >
          {windowBody}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary pr-5 pl-4 text-sm font-semibold text-primary-foreground shadow-lg lg:right-6 lg:bottom-6"
        >
          <Sparkles className="size-5" />
          Спросить Помощника
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Вариант C: строка внизу                                             */
/* ------------------------------------------------------------------ */

function VariantBar({
  page,
  navigate,
}: {
  readonly page: PageKey;
  readonly navigate: (p: PageKey) => void;
}) {
  const wide = useWide();
  const top = useHeaderBottom();
  const chat = useChat(page);
  const [open, setOpenState] = useState(browser.open);
  const setOpen = (v: boolean) => {
    browser.open = v;
    setOpenState(v);
  };
  const [showInfo, setShowInfo] = useState(false);
  const onMaterial = page !== "programme";
  const [context, setContext] = useState<Context>(
    onMaterial ? { about: pages[page].title } : {},
  );
  // На странице материала строка сама предлагает спросить о нём; на других страницах отметки нет.
  useEffect(() => {
    setContext(onMaterial ? { about: pages[page].title } : {});
  }, [page, onMaterial]);
  const go = (p: PageKey) => {
    if (!wide) setOpen(false);
    navigate(p);
  };
  const count = chat.messages.filter((m) => m.role !== "day").length;

  return (
    <>
      <style>{`[data-application-content]>div{padding-bottom:9rem!important}`}</style>
      <HostPage page={page} />
      <div
        className={cn(
          "fixed z-40 flex flex-col",
          wide
            ? "bottom-4 left-1/2 w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2"
            : "inset-x-0 bottom-0",
        )}
        style={!wide && open ? { top: 0 } : undefined}
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden bg-card",
            wide
              ? "rounded-2xl border border-border shadow-2xl"
              : "border-t border-border shadow-[0_-8px_24px_rgb(0_0_0/0.08)]",
          )}
        >
          {open ? (
            <div
              className="flex min-h-0 flex-col"
              style={
                wide
                  ? { height: `min(36rem, calc(100vh - ${top + 140}px))` }
                  : { flex: 1 }
              }
            >
              <div className="flex items-center gap-1 border-b border-border py-2 pr-2 pl-4">
                <ChatTitle />
                <IconButton
                  label="Кто видит разговор"
                  onClick={() => setShowInfo(!showInfo)}
                >
                  <Info className="size-4" />
                </IconButton>
                <IconButton
                  label="Свернуть разговор"
                  onClick={() => setOpen(false)}
                >
                  <ChevronDown className="size-5" />
                </IconButton>
              </div>
              {showInfo ? (
                <p className="m-0 border-b border-border bg-muted/60 px-4 py-2.5 text-sm leading-6">
                  {noticeText}
                </p>
              ) : null}
              <Conversation chat={chat} style={styles.bar} navigate={go} />
            </div>
          ) : null}
          <Composer
            chat={chat}
            context={context}
            setContext={setContext}
            rounded={!open}
            onFocus={() => setOpen(true)}
            placeholder={
              onMaterial ? "Спросите об этом материале" : "Спросите о курсе"
            }
            footer={
              open ? null : (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Sparkles className="size-3.5 text-accent" />
                  Помощник Inside · разговор ({count})
                </button>
              )
            }
          />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Рамка прототипа                                                     */
/* ------------------------------------------------------------------ */

function Prototype({
  variant,
  startOpen,
}: {
  readonly variant: Variant;
  readonly startOpen: boolean;
}) {
  // Каждая история начинает с заданного положения окна; разговор и страница общие для всех историй.
  useState(() => {
    browser.open = startOpen;
  });
  const [page, setPageState] = useState<PageKey>(browser.page);
  const [reloads, setReloads] = useState(0);
  const [, force] = useState(0);
  const navigate = (p: PageKey) => {
    browser.page = p;
    setPageState(p);
    document.querySelector("[data-application-content]")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  };
  const Variant = {
    panel: VariantPanel,
    window: VariantWindow,
    bar: VariantBar,
  }[variant];
  return (
    <>
      <Variant key={reloads} page={page} navigate={navigate} />
      <PrototypeBar
        page={page}
        navigate={navigate}
        reload={() => setReloads((r) => r + 1)}
        reset={(empty) => {
          server.messages = empty ? [] : [...history];
          browser.open = true;
          browser.noticeSeen = false;
          setReloads((r) => r + 1);
          force((n) => n + 1);
        }}
      />
    </>
  );
}

function PrototypeBar({
  page,
  navigate,
  reload,
  reset,
}: {
  readonly page: PageKey;
  readonly navigate: (p: PageKey) => void;
  readonly reload: () => void;
  readonly reset: (empty: boolean) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="fixed top-1/3 left-0 z-[60] font-mono text-[11px]">
      {shown ? (
        <div className="ml-1 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1 rounded-xl bg-[oklch(0.25_0.02_270)] p-1.5 text-white shadow-xl">
          <span className="px-1.5 opacity-60">Страница:</span>
          {(Object.keys(pages) as PageKey[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => navigate(p)}
              className={cn(
                "rounded-md px-2 py-1",
                p === page ? "bg-white text-black" : "hover:bg-white/15",
              )}
            >
              {pages[p].label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/30" />
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/15"
          >
            <RotateCcw className="size-3" />
            Перезагрузить
          </button>
          <button
            type="button"
            onClick={() => reset(true)}
            className="rounded-md px-2 py-1 hover:bg-white/15"
          >
            Новый ученик
          </button>
          <button
            type="button"
            onClick={() => reset(false)}
            className="rounded-md px-2 py-1 hover:bg-white/15"
          >
            С историей
          </button>
          <button
            type="button"
            aria-label="Скрыть панель прототипа"
            onClick={() => setShown(false)}
            className="rounded-md px-1.5 py-1 hover:bg-white/15"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShown(true)}
          className="rounded-r-lg bg-[oklch(0.25_0.02_270)] px-1 py-3 text-white opacity-60 shadow [writing-mode:vertical-rl] hover:opacity-100"
        >
          прототип
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stories                                                             */
/* ------------------------------------------------------------------ */

const environment = publicPageEnvironment("/materials/agent-first-skills", {
  account: "authenticated",
});

const meta = {
  ...environment,
  title: "Prototypes/Assistant chat",
  component: Prototype,
  decorators: [
    (Story) => (
      <ReadingProgressProvider accountId={null} resolved>
        <Story />
      </ReadingProgressProvider>
    ),
    ...environment.decorators,
  ],
  parameters: { ...environment.parameters, layout: "fullscreen" },
} satisfies Meta<typeof Prototype>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;
const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;

export const APanel: Story = {
  name: "A. Панель справа",
  args: { variant: "panel", startOpen: true },
  globals: desktop,
};
export const APanelMobile: Story = {
  name: "A. Панель справа, телефон",
  args: { variant: "panel", startOpen: false },
  globals: mobile,
};
export const BWindow: Story = {
  name: "B. Окно поверх",
  args: { variant: "window", startOpen: true },
  globals: desktop,
};
export const BWindowMobile: Story = {
  name: "B. Окно поверх, телефон",
  args: { variant: "window", startOpen: false },
  globals: mobile,
};
export const CBar: Story = {
  name: "C. Строка внизу",
  args: { variant: "bar", startOpen: true },
  globals: desktop,
};
export const CBarMobile: Story = {
  name: "C. Строка внизу, телефон",
  args: { variant: "bar", startOpen: false },
  globals: mobile,
};
