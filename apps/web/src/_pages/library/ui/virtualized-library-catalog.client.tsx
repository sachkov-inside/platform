"use client";

import {
  useVirtualizer,
  useWindowVirtualizer,
  type VirtualItem,
} from "@tanstack/react-virtual";
import { RefreshCw } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { LibraryCatalogPage } from "../model/library-view";
import { formatMaterialCount } from "../model/format-material-count";
import { Button } from "@/shared/ui/button";
import { LibraryMaterialGrid } from "./library-page";

const INITIAL_VIEWPORT = { height: 900, width: 1280 } as const;
const ESTIMATED_CATALOG_PAGE_HEIGHT = 1_400;
const AUTO_LOAD_ROOT_MARGIN = "800px 0px";
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
const SCROLL_STATE_KEY = "inside:library-scroll:v1";

type ReadyLibraryCatalogPage = Extract<
  LibraryCatalogPage,
  { readonly kind: "ready" }
>;

export function VirtualizedLibraryCatalog({
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  onLoadNextPage,
  pages,
}: {
  readonly hasNextPage: boolean;
  readonly isFetchNextPageError: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadNextPage: () => void;
  readonly pages: readonly ReadyLibraryCatalogPage[];
}) {
  "use no memo";

  const catalogRef = useRef<HTMLDivElement>(null);
  const desktopScrollRef = useRef<HTMLElement>(null);
  const loadSentinelRef = useRef<HTMLDivElement>(null);
  const viewportMode = useViewportMode();
  const [scrollMargin, setScrollMargin] = useState(0);
  const materialCount = useMemo(
    () => pages.reduce((count, page) => count + page.items.length, 0),
    [pages],
  );

  useLayoutEffect(() => {
    const catalog = catalogRef.current;
    if (catalog === null) {
      return;
    }

    const desktopScroll = catalog.closest<HTMLElement>("main");
    desktopScrollRef.current = desktopScroll;

    const updateScrollMargin = () => {
      const catalogTop = catalog.getBoundingClientRect().top;
      if (viewportMode === "desktop" && desktopScroll !== null) {
        const scrollTop = desktopScroll.getBoundingClientRect().top;
        setScrollMargin(catalogTop - scrollTop + desktopScroll.scrollTop);
        return;
      }
      setScrollMargin(catalogTop + window.scrollY);
    };
    updateScrollMargin();

    const observer = new ResizeObserver(updateScrollMargin);
    observer.observe(catalog);
    if (desktopScroll !== null) {
      observer.observe(desktopScroll);
    }
    return () => {
      observer.disconnect();
    };
  }, [viewportMode]);

  useScrollRestoration(viewportMode, desktopScrollRef);

  const sharedVirtualizerOptions = {
    count: pages.length,
    estimateSize: () => ESTIMATED_CATALOG_PAGE_HEIGHT,
    getItemKey: (index: number) =>
      pages[index]?.nextCursor ?? `catalog-page-${String(index)}`,
    initialRect: INITIAL_VIEWPORT,
    overscan: 1,
    scrollMargin,
    useFlushSync: false,
  } as const;
  const windowVirtualizer = useWindowVirtualizer<HTMLDivElement>({
    ...sharedVirtualizerOptions,
    enabled: viewportMode !== "desktop",
  });
  // TanStack Virtual owns mutable measurement functions and intentionally
  // opts this component out of React Compiler memoization.
  // oxlint-disable-next-line react/incompatible-library
  const desktopVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    ...sharedVirtualizerOptions,
    enabled: viewportMode === "desktop",
    getScrollElement: () => desktopScrollRef.current,
  });
  const virtualizer =
    viewportMode === "desktop" ? desktopVirtualizer : windowVirtualizer;

  useEffect(() => {
    const sentinel = loadSentinelRef.current;
    if (
      sentinel === null ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadNextPage();
        }
      },
      {
        root:
          viewportMode === "desktop" ? desktopScrollRef.current : null,
        rootMargin: AUTO_LOAD_ROOT_MARGIN,
      },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    onLoadNextPage,
    viewportMode,
  ]);

  return (
    <section
      aria-labelledby="materials-heading"
      className="mt-8 sm:mt-10"
      data-library-state="ready"
    >
      <div>
        <h2
          className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl"
          id="materials-heading"
        >
          Материалы
        </h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {formatMaterialCount(materialCount)} загружено
        </p>
      </div>

      <div className="mt-4" ref={catalogRef}>
        <div
          style={{
            height: `${String(virtualizer.getTotalSize())}px`,
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualPage) =>
            renderCatalogPage({
              measureElement: virtualizer.measureElement,
              page: pages[virtualPage.index],
              scrollMargin,
              virtualPage,
            }),
          )}
        </div>
      </div>

      <div aria-hidden="true" className="h-px" ref={loadSentinelRef} />
      <div aria-live="polite" className="mt-6 flex min-h-11 justify-center">
        {isFetchingNextPage ? (
          <p className="text-sm text-muted-foreground">Загружаем ещё материалы…</p>
        ) : null}
        {isFetchNextPageError ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить продолжение каталога.
            </p>
            <Button onClick={onLoadNextPage} size="sm" variant="outline">
              <RefreshCw aria-hidden="true" />
              Повторить
            </Button>
          </div>
        ) : null}
        {!hasNextPage && !isFetchNextPageError ? (
          <p className="text-sm text-muted-foreground">Все материалы загружены</p>
        ) : null}
      </div>
    </section>
  );
}

function renderCatalogPage({
  measureElement,
  page,
  scrollMargin,
  virtualPage,
}: {
  readonly measureElement: (element: HTMLDivElement | null) => void;
  readonly page: ReadyLibraryCatalogPage | undefined;
  readonly scrollMargin: number;
  readonly virtualPage: VirtualItem;
}) {
  if (page === undefined) {
    return null;
  }

  return (
    <div
      className="pb-4"
      data-index={virtualPage.index}
      key={virtualPage.key}
      ref={measureElement}
      style={{
        left: 0,
        position: "absolute",
        top: 0,
        transform: `translateY(${String(virtualPage.start - scrollMargin)}px)`,
        width: "100%",
      }}
    >
      <LibraryMaterialGrid
        items={page.items}
        label={`Материалы, страница ${String(virtualPage.index + 1)}`}
      />
    </div>
  );
}

function useViewportMode(): "desktop" | "mobile" | undefined {
  const [mode, setMode] = useState<"desktop" | "mobile">();

  useLayoutEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => {
      setMode(media.matches ? "desktop" : "mobile");
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  return mode;
}

function useScrollRestoration(
  viewportMode: "desktop" | "mobile" | undefined,
  desktopScrollRef: React.RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    if (viewportMode === undefined) {
      return;
    }

    const desktopScroll = desktopScrollRef.current;
    const savedOffset = readSavedScrollOffset(viewportMode);
    const animationFrame = window.requestAnimationFrame(() => {
      if (savedOffset === undefined) {
        return;
      }
      if (viewportMode === "desktop" && desktopScroll !== null) {
        desktopScroll.scrollTo({ top: savedOffset });
      } else {
        window.scrollTo({ top: savedOffset });
      }
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      const offset =
        viewportMode === "desktop" && desktopScroll !== null
          ? desktopScroll.scrollTop
          : window.scrollY;
      saveScrollOffset(viewportMode, offset);
    };
  }, [desktopScrollRef, viewportMode]);
}

function readSavedScrollOffset(
  viewportMode: "desktop" | "mobile",
): number | undefined {
  try {
    const parsed: unknown = JSON.parse(
      window.sessionStorage.getItem(SCROLL_STATE_KEY) ?? "null",
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("mode" in parsed) ||
      !("offset" in parsed) ||
      parsed.mode !== viewportMode ||
      typeof parsed.offset !== "number" ||
      !Number.isFinite(parsed.offset) ||
      parsed.offset < 0
    ) {
      return undefined;
    }
    return parsed.offset;
  } catch {
    return undefined;
  }
}

function saveScrollOffset(
  viewportMode: "desktop" | "mobile",
  offset: number,
) {
  try {
    window.sessionStorage.setItem(
      SCROLL_STATE_KEY,
      JSON.stringify({ mode: viewportMode, offset }),
    );
  } catch {
    // Scroll restoration is a progressive enhancement when storage is unavailable.
  }
}
