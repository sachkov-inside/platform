interface ViewportStory {
  readonly globals: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly title: string;
}

/**
 * Прогон историй молча уводит неизвестное имя размера на ширину холста по умолчанию (#599), и
 * «мобильная» история перестаёт проверять телефон. Сторож берёт имя тем же путём, что и прогон:
 * `globals.viewport.value`, иначе `parameters.viewport.defaultViewport`. Сверяет он его с
 * `parameters.viewport.options`, которые Storybook уже собрал из preview, meta и самой истории,
 * поэтому списка размеров не повторяет. Встроенные размеры Storybook намеренно не считаются
 * объявленными: у проекта одно объявление размеров.
 */
export function assertDeclaredViewport(story: ViewportStory): void {
  const parameters = asRecord(story.parameters.viewport);
  if (parameters.disable === true || parameters.disabled === true) return;
  const label = `История «${story.title} › ${story.name}»`;
  const global = story.globals.viewport;
  if (typeof global === "string") {
    throw new Error(
      `${label} задаёт размер строкой «${global}», а прогон читает только { value: "<имя>" }. Запишите globals.viewport как { value: "${global}", isRotated: false }.`,
    );
  }
  const requested = asRecord(global).value ?? parameters.defaultViewport;
  const declared = Object.keys(asRecord(parameters.options));
  if (requested === undefined || (typeof requested === "string" && declared.includes(requested))) return;
  throw new Error(
    `${label} просит размер «${typeof requested === "string" ? requested : JSON.stringify(requested)}», которого нет среди объявленных: ${declared.length > 0 ? declared.join(", ") : "нет"}. Возьмите объявленное имя или объявите размер один раз в parameters.viewport.options.`,
  );
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
