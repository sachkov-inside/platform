"use client";

import { FileCode2, FolderGit2 } from "lucide-react";
import { useId, useState } from "react";

/**
 * PROTOTYPE, prototype/ai-engineering-landing-v2. Окно репозитория: слева файлы, по которым
 * работает агент, сгруппированные по назначению; справа выбранный файл и одна строка о том, зачем
 * он нужен. Фрагменты черновые, по темам курса; перед production заменить настоящими фрагментами
 * из проекта курса.
 */
interface ProjectFile {
  readonly path: string;
  readonly kind: string;
  readonly why: string;
  readonly code: string;
}
const groups: readonly {
  readonly name: string;
  readonly files: readonly ProjectFile[];
}[] = [
  {
    name: "Агенту",
    files: [
      {
        path: "AGENTS.md",
        kind: "Инструкции",
        why: "Правила проекта. Агент читает их перед каждой задачей.",
        code: `# Сервис поддержки с AI-агентом

- Модули живут в src/modules/<имя>.
- Бизнес-логика не зависит от инфраструктуры.
- Решения ищи в docs/adr, термины в GLOSSARY.md.
- Перед pull request запусти pnpm check.`,
      },
      {
        path: ".agents/skills/code-review/SKILL.md",
        kind: "Скилл",
        why: "Повторяемый сценарий работы. Агент вызывает его сам, когда он нужен.",
        code: `---
name: code-review
description: Ревью изменений по стандартам и спецификации.
---

1. Прочитай спецификацию задачи.
2. Сверь код с CODING_STANDARDS.md.
3. Запиши замечания по важности.`,
      },
      {
        path: ".claude/settings.json",
        kind: "Хук",
        why: "Команда, которая запускается сама после каждой правки агента.",
        code: `{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{ "type": "command", "command": "pnpm lint --fix" }]
    }]
  }
}`,
      },
    ],
  },
  {
    name: "Домен и решения",
    files: [
      {
        path: "GLOSSARY.md",
        kind: "Словарь домена",
        why: "Общий язык. Агент называет вещи так же, как ты и заказчик.",
        code: `**Обращение**: вопрос клиента в любом канале.
**Черновик**: ответ агента, который проверяет оператор.
**Эскалация**: передача обращения оператору.

Не путать «обращение» и «тикет». Тикет: обращение в работе.`,
      },
      {
        path: "docs/adr/0004-schema-per-module.md",
        kind: "Архитектурное решение",
        why: "Почему система устроена именно так. Агент не пересматривает это в каждой сессии.",
        code: `# 4. У каждого модуля своя схема БД

Статус: принято

Модуль читает и пишет только свою схему.
Транзакции через границу модуля запрещены.`,
      },
    ],
  },
  {
    name: "Задача",
    files: [
      {
        path: "docs/specs/answer-draft.md",
        kind: "Спецификация",
        why: "Поведение и критерии готовности. По ним агент работает и проверяет результат.",
        code: `## Черновик ответа

Критерии готовности
- [ ] Ответ ссылается на статьи базы знаний
- [ ] Без источника обращение уходит оператору
- [ ] Персональные данные не попадают в модель`,
      },
      {
        path: "features/escalation.feature",
        kind: "Сценарий приёмки",
        why: "Пример поведения, который становится автоматическим тестом.",
        code: `Сценарий: Вопрос без ответа в базе знаний
  Дано в базе знаний нет статьи по вопросу
  Когда клиент задаёт этот вопрос
  Тогда обращение уходит оператору`,
      },
    ],
  },
  {
    name: "Проверки",
    files: [
      {
        path: "checks/boundaries.test.ts",
        kind: "Проверка архитектуры",
        why: "Тест, который не даёт агенту нарушить границы модулей.",
        code: `test("домен не знает про базу данных", () => {
  expect(importsOf("src/modules/*/domain"))
    .not.toContainPath("src/infrastructure");
});`,
      },
    ],
  },
];
const files = groups.flatMap((group) => group.files);

export function ArtifactWindow() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const file = files[selected];
  if (file === undefined) return null;
  const tabId = (index: number) => `${id}-tab-${String(index)}`;
  return (
    <div className="aie2-window">
      <div
        aria-label="Файлы проекта"
        aria-orientation="vertical"
        className="aie2-window-tree"
        role="tablist"
      >
        <span aria-hidden="true" className="aie2-window-repo">
          <FolderGit2 />
          repo
        </span>
        {groups.map((group) => (
          <div
            className="aie2-window-group"
            key={group.name}
            role="presentation"
          >
            <span aria-hidden="true" className="aie2-window-group-name">
              {group.name}
            </span>
            {group.files.map((entry) => {
              const index = files.indexOf(entry);
              return (
                <button
                  aria-controls={`${id}-panel`}
                  aria-selected={index === selected}
                  id={tabId(index)}
                  key={entry.path}
                  onClick={() => {
                    setSelected(index);
                  }}
                  onKeyDown={(event) => {
                    const step =
                      event.key === "ArrowDown" || event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowUp" || event.key === "ArrowLeft"
                          ? -1
                          : 0;
                    if (step === 0) return;
                    event.preventDefault();
                    const next =
                      (selected + step + files.length) % files.length;
                    setSelected(next);
                    document.getElementById(tabId(next))?.focus();
                  }}
                  role="tab"
                  tabIndex={index === selected ? 0 : -1}
                  type="button"
                >
                  <FileCode2 aria-hidden="true" />
                  <span>
                    <b>{entry.kind}</b>
                    {entry.path.split("/").at(-1)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div
        aria-labelledby={tabId(selected)}
        className="aie2-window-panel"
        id={`${id}-panel`}
        role="tabpanel"
      >
        <div className="aie2-window-head">
          <span className="aie2-window-path">{file.path}</span>
          <p>{file.why}</p>
        </div>
        <pre className="aie2-window-code" tabIndex={0}>
          <code>{file.code}</code>
        </pre>
      </div>
    </div>
  );
}
