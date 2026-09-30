"use client";

import { Minus, Plus, Scan, X } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { hasText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

import {
  FIT_VIEW,
  ZOOM_STEP,
  clampView,
  fittedSize,
  maxZoom,
  panBy,
  toggleZoomAt,
  zoomAt,
  type ViewerPoint,
  type ViewerSize,
  type ViewerView,
} from "../model/image-viewer-view";

/** Касание дальше этого расстояния считается перетаскиванием, а не нажатием. */
const TAP_SLOP_PX = 8;
/** Второе касание в пределах этого времени — двойное касание. */
const DOUBLE_TAP_MS = 300;
/** Сдвиг приближенной картинки стрелкой клавиатуры. */
const ARROW_PAN_PX = 80;
/** Чувствительность колеса мыши и щипка на трекпаде, который браузер присылает с `ctrlKey`. */
const WHEEL_ZOOM_RATE = 0.002;
const PINCH_WHEEL_ZOOM_RATE = 0.01;

const EMPTY_SIZE: ViewerSize = { height: 0, width: 0 };

interface Gesture {
  readonly startCenter: ViewerPoint;
  readonly startDistance: number;
  readonly startView: ViewerView;
}

/**
 * Картинка материала на весь экран: приближение колесом, щипком, кнопками и клавишами,
 * перетаскивание приближенной картинки. Закрывается Esc, кнопкой или нажатием на фон.
 */
export function MaterialImageViewer({
  alt,
  caption,
  height,
  onClose,
  src,
  width,
}: {
  readonly alt: string;
  readonly caption?: string | undefined;
  readonly height: number;
  readonly onClose: () => void;
  readonly src: string;
  readonly width: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const captionId = useId();
  const [stageSize, setStageSize] = useState<ViewerSize>(EMPTY_SIZE);
  const [storedView, setView] = useState<ViewerView>(FIT_VIEW);
  const [animated, setAnimated] = useState(false);
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, ViewerPoint>());
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ at: number; point: ViewerPoint } | null>(null);
  const lastPointerType = useRef("mouse");

  const image = { height, width };
  const fitted = fittedSize(image, stageSize);
  const limit = maxZoom(image, fitted);
  // После поворота экрана или смены окна прежний сдвиг может увести край картинки внутрь сцены.
  const view = clampView(storedView, fitted, stageSize, limit);
  // Последние значения для обработчика колеса, который подписан один раз.
  const latest = useRef({ fitted, limit, stageSize });
  useEffect(() => {
    latest.current = { fitted, limit, stageSize };
  });

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    closeButton.current?.focus();
    return () => {
      element?.close();
    };
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setStageSize({
        height: entry.contentRect.height,
        width: entry.contentRect.width,
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    // React подписывает колесо пассивно, а странице за окном нельзя прокручиваться.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const area = stage.current;
      if (
        area === null ||
        !(event.target instanceof Node) ||
        !area.contains(event.target)
      )
        return;
      const rate = event.ctrlKey ? PINCH_WHEEL_ZOOM_RATE : WHEEL_ZOOM_RATE;
      const point = stagePoint(area, event.clientX, event.clientY);
      setAnimated(false);
      setView((current) =>
        zoomAt(
          current,
          current.scale * Math.exp(-event.deltaY * rate),
          point,
          latest.current.fitted,
          latest.current.stageSize,
          latest.current.limit,
        ),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  const change = (next: (current: ViewerView) => ViewerView) => {
    setAnimated(true);
    setView(next);
  };
  const zoomBy = (factor: number) => {
    change((current) =>
      zoomAt(
        current,
        current.scale * factor,
        { x: 0, y: 0 },
        fitted,
        stageSize,
        limit,
      ),
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    lastPointerType.current = event.pointerType;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 1) moved.current = false;
    gesture.current = startGesture(pointers.current, view);
    setAnimated(false);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    const current = gesture.current;
    if (previous === undefined || current === null) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const center = pointersCenter(pointers.current);
    const shift = {
      x: center.x - current.startCenter.x,
      y: center.y - current.startCenter.y,
    };
    if (Math.hypot(shift.x, shift.y) > TAP_SLOP_PX) moved.current = true;
    const area = stage.current;
    if (area === null) return;
    if (pointers.current.size >= 2 && current.startDistance > 0) {
      const ratio = pointersDistance(pointers.current) / current.startDistance;
      const origin = stagePoint(
        area,
        current.startCenter.x,
        current.startCenter.y,
      );
      const zoomed = zoomAt(
        current.startView,
        current.startView.scale * ratio,
        origin,
        fitted,
        stageSize,
        limit,
      );
      setView(panBy(zoomed, shift, fitted, stageSize, limit));
    } else if (current.startView.scale > 1) {
      setView(panBy(current.startView, shift, fitted, stageSize, limit));
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const area = stage.current;
    if (pointers.current.size > 0) {
      // Один палец остался после щипка: дальше он двигает картинку от нового положения.
      gesture.current = startGesture(pointers.current, view);
      return;
    }
    gesture.current = null;
    if (moved.current || area === null || event.type === "pointercancel")
      return;
    const point = stagePoint(area, event.clientX, event.clientY);
    const onImage = isOnImage(point, view, fitted);
    if (event.pointerType !== "mouse") {
      const previous = lastTap.current;
      if (
        previous !== null &&
        event.timeStamp - previous.at < DOUBLE_TAP_MS &&
        Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <
          TAP_SLOP_PX * 3
      ) {
        lastTap.current = null;
        change((current) =>
          toggleZoomAt(current, point, fitted, stageSize, limit),
        );
        return;
      }
      lastTap.current = { at: event.timeStamp, point };
    }
    if (!onImage && view.scale === 1) onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    const arrow = arrowShift(event.key);
    // Esc закрывает здесь, а `onCancel` ловит остальные запросы закрытия, например «Назад» на Android.
    if (event.key === "Escape") onClose();
    else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / ZOOM_STEP);
    else if (event.key === "0") change(() => FIT_VIEW);
    else if (arrow !== null && view.scale > 1)
      change((current) => panBy(current, arrow, fitted, stageSize, limit));
    else return;
    event.preventDefault();
  };

  const label = hasText(alt) ? alt : "Изображение";

  return (
    <dialog
      aria-describedby={hasText(caption) ? captionId : undefined}
      aria-label={`${label}, просмотр крупно`}
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none touch-none flex-col overflow-hidden bg-neutral-950 p-0 text-white outline-none backdrop:bg-neutral-950"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      ref={dialog}
    >
      <div className="flex shrink-0 items-center justify-end gap-1 p-2 sm:p-3">
        <div
          aria-label="Масштаб"
          className="mr-auto flex items-center gap-1 rounded-xl bg-white/10 p-1"
          role="group"
        >
          <ViewerButton
            disabled={view.scale <= 1}
            label="Отдалить"
            onClick={() => {
              zoomBy(1 / ZOOM_STEP);
            }}
          >
            <Minus />
          </ViewerButton>
          <output
            aria-live="polite"
            className="min-w-14 text-center text-sm tabular-nums"
          >
            {`${String(Math.round(view.scale * 100))}%`}
          </output>
          <ViewerButton
            disabled={view.scale >= limit}
            label="Приблизить"
            onClick={() => {
              zoomBy(ZOOM_STEP);
            }}
          >
            <Plus />
          </ViewerButton>
          <ViewerButton
            disabled={view.scale === 1 && view.x === 0 && view.y === 0}
            label="Вписать в экран"
            onClick={() => {
              change(() => FIT_VIEW);
            }}
          >
            <Scan />
          </ViewerButton>
        </div>
        <ViewerButton label="Закрыть" onClick={onClose} ref={closeButton}>
          <X />
        </ViewerButton>
      </div>
      <div
        className={`relative min-h-0 flex-1 overflow-hidden select-none ${
          view.scale > 1 ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        data-testid="image-viewer-stage"
        onDoubleClick={(event) => {
          const area = stage.current;
          // Двойное касание пальцем уже обработано в onPointerUp.
          if (area === null || lastPointerType.current !== "mouse") return;
          const point = stagePoint(area, event.clientX, event.clientY);
          if (!isOnImage(point, view, fitted)) return;
          change((current) =>
            toggleZoomAt(current, point, fitted, stageSize, limit),
          );
        }}
        onPointerCancel={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={stage}
      >
        {failed ? (
          <p
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80"
            role="status"
          >
            Не удалось загрузить изображение.
          </p>
        ) : fitted.width > 0 ? (
          // oxlint-disable-next-line next/no-img-element -- The protected route needs the viewer's session.
          <img
            alt={alt}
            className={`absolute top-1/2 left-1/2 max-w-none ${
              animated
                ? "motion-safe:transition-transform motion-safe:duration-(--motion-duration-shell) motion-safe:ease-(--motion-ease-out)"
                : ""
            }`}
            decoding="async"
            draggable={false}
            height={height}
            onError={() => {
              setFailed(true);
            }}
            src={src}
            style={{
              height: fitted.height,
              transform: `translate(-50%, -50%) translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})`,
              width: fitted.width,
            }}
            width={width}
          />
        ) : null}
      </div>
      {hasText(caption) ? (
        <p
          className="shrink-0 px-4 py-3 text-center text-sm text-white/80"
          id={captionId}
        >
          {caption}
        </p>
      ) : null}
    </dialog>
  );
}

function ViewerButton({
  children,
  disabled = false,
  label,
  onClick,
  ref,
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      aria-label={label}
      className="size-11 text-white hover:bg-white/15 hover:text-white [&_svg:not([class*='size-'])]:size-5"
      disabled={disabled}
      onClick={onClick}
      ref={ref}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}

function stagePoint(area: HTMLElement, x: number, y: number): ViewerPoint {
  const rect = area.getBoundingClientRect();
  return {
    x: x - rect.left - rect.width / 2,
    y: y - rect.top - rect.height / 2,
  };
}

function isOnImage(
  point: ViewerPoint,
  view: ViewerView,
  fitted: ViewerSize,
): boolean {
  return (
    Math.abs(point.x - view.x) <= (fitted.width * view.scale) / 2 &&
    Math.abs(point.y - view.y) <= (fitted.height * view.scale) / 2
  );
}

function startGesture(
  pointers: ReadonlyMap<number, ViewerPoint>,
  view: ViewerView,
): Gesture {
  return {
    startCenter: pointersCenter(pointers),
    startDistance: pointersDistance(pointers),
    startView: view,
  };
}

function pointersCenter(pointers: ReadonlyMap<number, ViewerPoint>) {
  const points = [...pointers.values()].slice(0, 2);
  const count = Math.max(1, points.length);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / count,
    y: points.reduce((sum, point) => sum + point.y, 0) / count,
  };
}

function pointersDistance(pointers: ReadonlyMap<number, ViewerPoint>) {
  const [first, second] = [...pointers.values()];
  if (first === undefined || second === undefined) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function arrowShift(key: string): ViewerPoint | null {
  if (key === "ArrowLeft") return { x: ARROW_PAN_PX, y: 0 };
  if (key === "ArrowRight") return { x: -ARROW_PAN_PX, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: ARROW_PAN_PX };
  if (key === "ArrowDown") return { x: 0, y: -ARROW_PAN_PX };
  return null;
}
