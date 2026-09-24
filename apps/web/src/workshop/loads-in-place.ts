/**
 * Общее для историй «LoadsInPlace» (#670): страница приходит слоями, как на маршруте, и ни один слой
 * не имеет права сдвинуть предыдущий. История держит ожидания открытыми и снимает их по очереди,
 * измеряя одни и те же опоры в каждом состоянии.
 */

export interface StoryViewport {
  readonly globals: { readonly viewport: { readonly value: string; readonly isRotated: false } };
  readonly width: number;
}
export const desktop: StoryViewport = { globals: { viewport: { value: "desktop1440", isRotated: false } }, width: 1440 };
export const mobile: StoryViewport = { globals: { viewport: { value: "mobile390", isRotated: false } }, width: 390 };

/** Слои маршрута (ADR 0027): под скелетом — общая часть, под ней — личная. */
export class StagedLoading {
  readonly sharedPart: Promise<void>;
  readonly personalPart: Promise<void>;
  deliverSharedPart: () => void = () => undefined;
  deliverPersonalPart: () => void = () => undefined;

  constructor() {
    this.sharedPart = new Promise((resolve) => { this.deliverSharedPart = resolve; });
    this.personalPart = new Promise((resolve) => { this.deliverPersonalPart = resolve; });
  }
}

/** Загрузчик истории: у каждого показа своя последовательность слоёв. */
export const stagedLoaders = [() => ({ sequence: new StagedLoading() })];

/**
 * Опоры сравниваются только в заявленной ширине и со своими шрифтами: иначе история мерила бы чужую
 * раскладку и совпадение ничего бы не доказывало.
 */
export async function settleStoryFrame(width: number): Promise<void> {
  if (window.innerWidth !== width) throw new Error(`История открыта в ширине ${String(window.innerWidth)}, а не ${String(width)}`);
  await document.fonts.ready;
}

export function stagedLoadingOf(loaded: Record<string, unknown>): StagedLoading {
  const sequence = loaded.sequence;
  if (!(sequence instanceof StagedLoading)) throw new Error("История загрузки не получила последовательность слоёв");
  return sequence;
}

export interface Box { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** Положение опоры страницы; её отсутствие — незаконченная отрисовка, а не нулевой размер. */
export function boxOf(root: HTMLElement, selector: string): Box {
  const element = root.querySelector(selector);
  if (element === null) throw new Error(`Страница отрисована не полностью: нет ${selector}`);
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

/** Начало опоры без высоты: у скелета она условная, у готовой страницы зависит от данных. */
export function originOf(box: Box): Omit<Box, "height"> {
  return { left: box.left, top: box.top, width: box.width };
}
