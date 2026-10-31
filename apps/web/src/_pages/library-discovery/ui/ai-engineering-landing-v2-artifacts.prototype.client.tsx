"use client";

import { FileCode2, FolderGit2 } from "lucide-react";
import { useId, useState } from "react";

/**
 * PROTOTYPE, prototype/ai-engineering-landing-v2. Окно репозитория: слева файлы метода, справа
 * содержимое выбранного. Фрагменты черновые, по темам курса; перед production заменить настоящими
 * фрагментами из проекта курса.
 */
const files = [
  {
    path: "docs/specs/sign-in.md",
    kind: "Спецификация",
    code: `## Вход в систему

Критерии готовности
- [ ] После 5 ошибок вход закрыт на 15 минут
- [ ] Выход отзывает все токены сессии
- [ ] Ошибка не раскрывает, есть ли email`,
  },
  {
    path: "features/sign-in.feature",
    kind: "Сценарий приёмки",
    code: `Сценарий: Блокировка после неудачных попыток
  Дано пользователь ввёл неверный пароль 5 раз
  Когда он снова пытается войти
  Тогда вход отклонён`,
  },
  {
    path: "docs/adr/0004-schema-per-module.md",
    kind: "Решение",
    code: `# 4. У каждого модуля своя схема БД

Модуль читает и пишет только свою схему.
Транзакции через границу модуля запрещены.`,
  },
  {
    path: "checks/boundaries.test.ts",
    kind: "Проверка",
    code: `test("домен не знает про базу данных", () => {
  expect(importsOf("src/modules/*/domain"))
    .not.toContainPath("src/infrastructure");
});`,
  },
] as const;

export function ArtifactWindow() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const file = files[selected] ?? files[0];
  return (
    <div className="aie2-window">
      <div
        aria-label="Файлы метода"
        className="aie2-window-tree"
        role="tablist"
        aria-orientation="vertical"
      >
        <span className="aie2-window-repo">
          <FolderGit2 aria-hidden="true" />
          repo
        </span>
        {files.map((entry, index) => (
          <button
            aria-controls={`${id}-panel`}
            aria-selected={index === selected}
            id={`${id}-tab-${String(index)}`}
            key={entry.path}
            onClick={() => {
              setSelected(index);
            }}
            role="tab"
            tabIndex={index === selected ? 0 : -1}
            type="button"
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (step === 0) return;
              event.preventDefault();
              const next = (selected + step + files.length) % files.length;
              setSelected(next);
              document.getElementById(`${id}-tab-${String(next)}`)?.focus();
            }}
          >
            <FileCode2 aria-hidden="true" />
            <span>
              <b>{entry.kind}</b>
              {entry.path.split("/").at(-1)}
            </span>
          </button>
        ))}
      </div>
      <div className="aie2-window-panel">
        <span className="aie2-window-path">{file.path}</span>
        <pre
          aria-labelledby={`${id}-tab-${String(selected)}`}
          className="aie2-window-code"
          id={`${id}-panel`}
          role="tabpanel"
          tabIndex={0}
        >
          <code>{file.code}</code>
        </pre>
      </div>
    </div>
  );
}
