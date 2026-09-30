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
 * чтобы небольшой скриншот не выглядел размытым до приближения.
 */
export function fittedSize(image: ViewerSize, stage: ViewerSize): ViewerSize {
  if (image.width <= 0 || image.height <= 0) return { height: 0, width: 0 };
  const ratio = Math.min(
    1,
    stage.width / image.width,
    stage.height / image.height,
  );
  return { height: image.height * ratio, width: image.width * ratio };
}

/** Предел приближения: вдвое больше собственных пикселей картинки, в границах 3–8. */
export function maxZoom(image: ViewerSize, fitted: ViewerSize): number {
  if (fitted.width <= 0) return MIN_ZOOM_LIMIT;
  return Math.min(
    MAX_ZOOM_LIMIT,
    Math.max(MIN_ZOOM_LIMIT, (image.width / fitted.width) * 2),
  );
}

/** Не даёт увести край картинки внутрь сцены: пока картинка меньше сцены, она стоит по центру. */
export function clampView(
  view: ViewerView,
  fitted: ViewerSize,
  stage: ViewerSize,
  limit: number,
): ViewerView {
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

/** Меняет масштаб так, чтобы точка картинки под `point` осталась на месте. */
export function zoomAt(
  view: ViewerView,
  scale: number,
  point: ViewerPoint,
  fitted: ViewerSize,
  stage: ViewerSize,
  limit: number,
): ViewerView {
  const next = Math.min(limit, Math.max(1, scale));
  const factor = next / view.scale;
  return clampView(
    {
      scale: next,
      x: point.x - (point.x - view.x) * factor,
      y: point.y - (point.y - view.y) * factor,
    },
    fitted,
    stage,
    limit,
  );
}

/** Сдвигает приближенную картинку вслед за пальцем, мышью или стрелками. */
export function panBy(
  view: ViewerView,
  delta: ViewerPoint,
  fitted: ViewerSize,
  stage: ViewerSize,
  limit: number,
): ViewerView {
  return clampView(
    { scale: view.scale, x: view.x + delta.x, y: view.y + delta.y },
    fitted,
    stage,
    limit,
  );
}

/** Двойной клик или касание: приблизить к точке, а приближенную картинку снова вписать. */
export function toggleZoomAt(
  view: ViewerView,
  point: ViewerPoint,
  fitted: ViewerSize,
  stage: ViewerSize,
  limit: number,
): ViewerView {
  return view.scale > 1
    ? FIT_VIEW
    : zoomAt(view, DOUBLE_TAP_ZOOM, point, fitted, stage, limit);
}
