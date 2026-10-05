/**
 * Очистка текста отчёта прохода (#906). Отчёт лежит в artifact публичного репозитория, поэтому в нём
 * нет cookies, токенов и персональных данных. Известные значения (ящик, ключ M2M, выпущенные токены)
 * заменяются точно; email (и в форме URL), JWT, bearer, PAT Logto, параметры входа в URL и заголовки cookies — по
 * форме, на случай значения, которого проход не знает.
 */
const hidden = "[скрыто]";

const shapes: readonly (readonly [RegExp, string])[] = [
  [/(?:set-)?cookie:[^\n"]*/giu, `cookie: ${hidden}`],
  [/\bbearer\s+[\w.~+/-]+=*/giu, `Bearer ${hidden}`],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/gu, hidden],
  [/\bpat_[\w-]+/gu, hidden],
  [
    /\b(one_time_token|login_hint|access_token|id_token|refresh_token|subject_token|code|state|token)=[^&\s"'<>]+/giu,
    `$1=${hidden}`,
  ],
  [/[\w.+%-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+/giu, hidden],
];

/** Секреты короче этой длины не ищутся точно: короткая строка совпала бы с обычным текстом. */
const minimumSecretLength = 6;

export function redactPassText(
  text: string,
  secrets: readonly string[],
): string {
  let redacted = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length < minimumSecretLength) continue;
    for (const form of new Set([secret, encodeURIComponent(secret)]))
      redacted = redacted.split(form).join(hidden);
  }
  for (const [shape, replacement] of shapes)
    redacted = redacted.replace(shape, replacement);
  return redacted;
}
