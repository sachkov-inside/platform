import { mkdir } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

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
  return requested === issueFolder
    ? `${repositoryRoot}docs/evidence/${issueFolder}`
    : `${repositoryRoot}ci-artifacts/evidence/${issueFolder}`;
}

export function evidencePath(issueFolder, fileName, environment = process.env) {
  return `${evidenceDirectory(issueFolder, environment)}/${fileName}`;
}

/** Каталог создаётся перед первым снимком: у артефактов его обычно ещё нет. */
export async function prepareEvidenceDirectory(issueFolder, environment = process.env) {
  const directory = evidenceDirectory(issueFolder, environment);
  await mkdir(directory, { recursive: true });
  return directory;
}
