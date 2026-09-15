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
 * поэтому списка размеров не повторяет. Объявленным считается только размер из этих options:
 * общий — в `preview.tsx`, особый — явно в самой истории. Встроенные размеры Storybook туда не входят.
 */
export function assertDeclaredViewport(story: ViewportStory): void {
  const viewport = asRecord(story.parameters.viewport);
  if (viewport.disable === true || viewport.disabled === true) return;
  const label = `История «${story.title} › ${story.name}»`;
  const viewportGlobal = story.globals.viewport;
  if (typeof viewportGlobal === "string") {
    throw new Error(
      `${label} задаёт размер строкой «${viewportGlobal}», а прогон читает только { value: "<имя>" }. Запишите globals.viewport как { value: "${viewportGlobal}", isRotated: false }.`,
    );
  }
  const requested = asRecord(viewportGlobal).value ?? viewport.defaultViewport;
  if (requested === undefined) return;
  const declared = Object.keys(asRecord(viewport.options));
  if (typeof requested === "string" && declared.includes(requested)) return;
  const requestedLabel = typeof requested === "string" ? requested : JSON.stringify(requested);
  const declaredLabel = declared.length > 0 ? declared.join(", ") : "нет";
  throw new Error(
    `${label} просит размер «${requestedLabel}», которого нет среди объявленных: ${declaredLabel}. Возьмите объявленное имя или объявите размер один раз в parameters.viewport.options.`,
  );
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
