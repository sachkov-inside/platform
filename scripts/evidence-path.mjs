import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const issueFolderPattern = /^issue-\d+$/u;

/**
 * Корень репозитория ищется по его собственному признаку, а не от адреса этого файла: сквозные
 * спеки Playwright транспилирует в CommonJS, где `import.meta` не существует, и ссылка на него
 * роняла загрузку всего набора. Рабочие каталоги у потребителей разные — корень и `apps/web`, —
 * поэтому подъём идёт до файла рабочего пространства.
 */
function findRepositoryRoot() {
  let directory = process.cwd();
  for (;;) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`No pnpm-workspace.yaml above ${process.cwd()}: evidence has no repository to write into`);
    }
    directory = parent;
  }
}

/**
 * Куда прогон кладёт снимок-свидетельство.
 *
 * По умолчанию — в игнорируемые Git артефакты: прогон, запущенный ради одной задачи, снимает
 * и чужие сценарии тоже, и раньше они переписывали свидетельства соседних задач прямо в дереве.
 * Замеченное, это стоило внимания каждому, кто гоняет набор; незамеченное — уносило в pull request
 * картинки, снятые другой работой на другом коде.
 *
 * Обновление своих свидетельств остаётся явным: `UPDATE_EVIDENCE=issue-529` кладёт в
 * `docs/evidence/issue-529` снимки только этой задачи, остальные по-прежнему уходят в артефакты.
 */
export function evidenceDirectory(issueFolder, environment = process.env) {
  const requested = environment.UPDATE_EVIDENCE?.trim();
  // Опечатка в имени задачи иначе просто не сработала бы: снимки молча ушли бы в артефакты, а
  // человек искал бы их в дереве и решил, что явный режим не работает.
  if (requested !== undefined && requested !== "" && !issueFolderPattern.test(requested)) {
    throw new Error(`UPDATE_EVIDENCE must name an issue folder such as issue-529, not "${requested}"`);
  }
  return requested === issueFolder
    ? path.join(findRepositoryRoot(), "docs", "evidence", issueFolder)
    : path.join(findRepositoryRoot(), "ci-artifacts", "evidence", issueFolder);
}

export function evidencePath(issueFolder, fileName, environment = process.env) {
  return path.join(evidenceDirectory(issueFolder, environment), fileName);
}

/** Каталог создаётся перед первым снимком: у артефактов его обычно ещё нет. */
export async function prepareEvidenceDirectory(issueFolder, environment = process.env) {
  const directory = evidenceDirectory(issueFolder, environment);
  await mkdir(directory, { recursive: true });
  return directory;
}
