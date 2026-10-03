/**
 * Геометрия просмотра картинки крупно. Картинка вписана в сцену и стоит по центру; вид задаёт
 * множитель к вписанному размеру и сдвиг центра картинки от центра сцены в CSS-пикселях.
 * Точки жестов тоже отсчитываются от центра сцены.
 */

export interface ViewerSize {
  readonly height: number;
  readonly width: number;
}

export interface ViewerPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewerView extends ViewerPoint {
  readonly scale: number;
}

/** Всё, что ограничивает вид: вписанный размер картинки, сцена и предел приближения. */
export interface ViewerBounds {
  readonly fitted: ViewerSize;
  readonly limit: number;
  readonly stage: ViewerSize;
}

/** Вписанная картинка: множитель 1 и без сдвига. */
export const FIT_VIEW: ViewerView = { scale: 1, x: 0, y: 0 };

/** Шаг кнопок «+» и «−» и клавиш. */
export const ZOOM_STEP = 1.5;

/** Приближение по двойному клику или двойному касанию. */
const DOUBLE_TAP_ZOOM = 2.5;

/** Предел приближения не меньше этого множителя даже для картинки, которая вписана без уменьшения. */
const MIN_ZOOM_LIMIT = 3;

/** Предел приближения не больше этого множителя, чтобы картинка не превращалась в пиксели. */
const MAX_ZOOM_LIMIT = 8;

/**
 * Вписанный размер картинки: целиком помещается в сцену и не растягивается больше своих пикселей,
 * чтобы небольшой скриншот не выглядел размытым до приближения. Предел приближения — вдвое больше
 * собственных пикселей картинки, в границах 3–8.
 */
export function viewerBounds(
  image: ViewerSize,
  stage: ViewerSize,
): ViewerBounds {
  if (image.width <= 0 || image.height <= 0)
    return { fitted: { height: 0, width: 0 }, limit: MIN_ZOOM_LIMIT, stage };
  const ratio = Math.min(
    1,
    stage.width / image.width,
    stage.height / image.height,
  );
  const fitted = { height: image.height * ratio, width: image.width * ratio };
  const limit =
    fitted.width <= 0
      ? MIN_ZOOM_LIMIT
      : Math.min(
          MAX_ZOOM_LIMIT,
          Math.max(MIN_ZOOM_LIMIT, (image.width / fitted.width) * 2),
        );
  return { fitted, limit, stage };
}

/** Не даёт увести край картинки внутрь сцены: пока картинка меньше сцены, она стоит по центру. */
export function clampView(view: ViewerView, bounds: ViewerBounds): ViewerView {
  const { fitted, limit, stage } = bounds;
  const scale = Math.min(limit, Math.max(1, view.scale));
  const spanX = Math.max(0, (fitted.width * scale - stage.width) / 2);
  const spanY = Math.max(0, (fitted.height * scale - stage.height) / 2);
  return {
    scale,
    x: within(view.x, spanX),
    y: within(view.y, spanY),
  };
}

function within(value: number, span: number): number {
  // Без запаса картинка стоит ровно по центру; так в виде не появляется -0.
  return span === 0 ? 0 : Math.min(span, Math.max(-span, value));
}

/**
 * Щипок: точка картинки под `origin` остаётся под пальцами, а затем уезжает вместе с ними на
 * `shift`. Край ограничивается один раз в конце, чтобы у края картинка не отставала от пальцев.
 */
export function pinchView(
  start: ViewerView,
  scale: number,
  origin: ViewerPoint,
  shift: ViewerPoint,
  bounds: ViewerBounds,
): ViewerView {
  const next = Math.min(bounds.limit, Math.max(1, scale));
  const factor = next / start.scale;
  return clampView(
    {
      scale: next,
      x: origin.x - (origin.x - start.x) * factor + shift.x,
      y: origin.y - (origin.y - start.y) * factor + shift.y,
    },
    bounds,
  );
}

/** Меняет масштаб так, чтобы точка картинки под `point` осталась на месте. */
export function zoomAt(
  view: ViewerView,
  scale: number,
  point: ViewerPoint,
  bounds: ViewerBounds,
): ViewerView {
  return pinchView(view, scale, point, { x: 0, y: 0 }, bounds);
}

/** Сдвигает приближенную картинку вслед за пальцем, мышью или стрелками. */
export function panBy(
  view: ViewerView,
  delta: ViewerPoint,
  bounds: ViewerBounds,
): ViewerView {
  return pinchView(view, view.scale, { x: 0, y: 0 }, delta, bounds);
}

/** Двойной клик или касание: приблизить к точке, а приближенную картинку снова вписать. */
export function toggleZoomAt(
  view: ViewerView,
  point: ViewerPoint,
  bounds: ViewerBounds,
): ViewerView {
  return view.scale > 1
    ? FIT_VIEW
    : zoomAt(view, DOUBLE_TAP_ZOOM, point, bounds);
}

/** Попадает ли точка сцены на картинку при текущем виде; нажатие мимо закрывает просмотр. */
export function isOnImage(
  point: ViewerPoint,
  view: ViewerView,
  bounds: ViewerBounds,
): boolean {
  return (
    Math.abs(point.x - view.x) <= (bounds.fitted.width * view.scale) / 2 &&
    Math.abs(point.y - view.y) <= (bounds.fitted.height * view.scale) / 2
  );
}
