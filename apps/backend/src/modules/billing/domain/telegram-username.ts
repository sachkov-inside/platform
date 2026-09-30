/**
 * Telegram username в канонической форме: без `@` и ссылки, в нижнем регистре. Telegram
 * сравнивает username без учёта регистра; допустимы латиница, цифры и `_`, первая — буква.
 */
export const telegramUsernamePattern = /^[a-z][a-z0-9_]{3,31}$/u;
const linkPrefix = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//u;

/**
 * Приводит запись анкеты к username: `@nick`, `nick`, `t.me/nick`, `https://t.me/nick`, пробелы
 * и регистр. Всё, что username не является, — email, телефон, имя с пробелом — даёт `null`.
 */
export function normalizeTelegramUsername(raw: string): string | null {
  const compact = raw
    .trim()
    .replace(/^"(.*)"$/u, "$1")
    .trim()
    .toLowerCase();
  const withoutLink = compact.replace(linkPrefix, "").replace(/[/?#].*$/u, "");
  // Пробел после `@` в анкете — опечатка, а не часть ника.
  const username = withoutLink.startsWith("@")
    ? withoutLink.slice(1).trimStart()
    : withoutLink;
  return telegramUsernamePattern.test(username) ? username : null;
}

export interface ParsedRespondentList {
  /** Уникальные username в канонической форме. */
  readonly usernames: readonly string[];
  /** Непустые строки, в которых username не распознан. Их содержимое не сохраняется. */
  readonly unrecognized: number;
}

/**
 * Разбирает колонку анкеты, вставленную целиком: одна запись на строку. Пустые строки
 * пропускаются, повторы схлопываются.
 */
export function parseRespondentList(text: string): ParsedRespondentList {
  const usernames = new Set<string>();
  let unrecognized = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    const username = normalizeTelegramUsername(line);
    if (username === null) unrecognized += 1;
    else usernames.add(username);
  }
  return { usernames: [...usernames], unrecognized };
}
