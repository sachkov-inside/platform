interface ViewportStory {
  readonly globals: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly title: string;
}

/**
 * Прогон историй молча уводит неизвестное имя размера на ширину холста по умолчанию (#599), и
 * «мобильная» история перестаёт проверять телефон. Сторож сверяет имя с тем набором, который
 * Storybook уже собрал из preview, meta и самой истории, поэтому списка размеров не повторяет.
 */
export function assertDeclaredViewport(story: ViewportStory): void {
  const parameters = record(story.parameters.viewport);
  const declared = Object.keys(record(parameters.options));
  for (const requested of [viewportName(story.globals.viewport), parameters.defaultViewport]) {
    if (typeof requested !== "string" || declared.includes(requested)) continue;
    throw new Error(
      `История «${story.title} › ${story.name}» просит размер «${requested}», которого нет среди объявленных: ${declared.length > 0 ? declared.join(", ") : "нет"}. Возьмите объявленное имя или объявите размер один раз в parameters.viewport.options.`,
    );
  }
}

function viewportName(global: unknown): unknown {
  return typeof global === "string" ? global : record(global).value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
