"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  reconcileCourseNavigation,
  selectCourseNavigation,
  type CourseNavigationIntent,
} from "../model/course-navigation-selection";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";
import { CourseRail, ProgrammeDialog } from "./course-reading.client";
import {
  CourseReadingHostContext,
  type CourseFramePublication,
} from "./course-reading-host-context.client";
import styles from "./course-reading.module.css";

interface CourseLocation {
  readonly pathname: string;
  readonly courseSlug: string | undefined;
}

/** The observer can suspend without replacing the visible shell or its route children. */
function CourseLocationObserver({
  onChange,
}: {
  readonly onChange: (location: CourseLocation) => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const from = params.getAll("from");
  const courseSlug = parseMaterialReaderReturnTarget(
    from.length === 1 ? from[0] : undefined,
  ).seriesSlug;
  useLayoutEffect(() => {
    onChange({ pathname, courseSlug });
  }, [onChange, pathname, courseSlug]);
  return null;
}

/** Keep the chapter rail and its controls outside replaceable App Router page content. */
export function CourseReadingHost({
  children,
  pathname,
}: {
  readonly children: ReactNode;
  readonly pathname: string;
}) {
  const [frame, setFrame] = useState<CourseFramePublication | null>(null);
  const [intent, setIntent] = useState<CourseNavigationIntent | null>(null);
  const selectedId = intent?.id ?? null;
  useEffect(() => {
    const clear = () => {
      setIntent(null);
    };
    window.addEventListener("popstate", clear);
    return () => {
      window.removeEventListener("popstate", clear);
    };
  }, []);
  const [location, setLocation] = useState<CourseLocation | null>(null);
  const publish = useCallback((next: CourseFramePublication) => {
    setIntent((previous) => reconcileCourseNavigation(previous, next.context));
    setFrame((previous) =>
      previous?.context === next.context &&
      previous.supplementaryTitle === next.supplementaryTitle &&
      previous.pathname === next.pathname
        ? previous
        : next,
    );
  }, []);
  const context = frame?.context;
  const navigation =
    context == null ? null : selectCourseNavigation(context, selectedId);
  const courseSlug =
    context == null
      ? undefined
      : parseMaterialReaderReturnTarget(context.href).seriesSlug;
  const targets =
    context == null
      ? []
      : [
          ...(context.materialHrefs ?? []),
          ...context.chapters.flatMap((chapter) =>
            chapter.steps.map((step) => step.href),
          ),
          ...(context.references ?? []).map((reference) => reference.href),
        ];
  const knownStep = targets.some((href) => href.split("?")[0] === pathname);
  const active =
    navigation != null &&
    knownStep &&
    (!pathname.startsWith("/materials/") ||
      location?.courseSlug === courseSlug);
  const publication = useMemo(() => ({ publish, active }), [publish, active]);
  return (
    <CourseReadingHostContext.Provider value={publication}>
      <Suspense fallback={null}>
        <CourseLocationObserver onChange={setLocation} />
      </Suspense>
      <div
        className={active ? styles["host"] : undefined}
        data-course-reading-host={active ? "" : undefined}
        data-course-reading={active ? "" : undefined}
        onClickCapture={(event) => {
          if (
            !active ||
            context == null ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          const link =
            event.target instanceof Element
              ? event.target.closest<HTMLAnchorElement>("a[href]")
              : null;
          if (
            link === null ||
            link.hasAttribute("download") ||
            (link.target !== "" && link.target !== "_self")
          )
            return;
          const target = new URL(link.href);
          if (target.origin !== window.location.origin) return;
          if (
            target.pathname.startsWith("/materials/") &&
            parseMaterialReaderReturnTarget(
              target.searchParams.get("from") ?? undefined,
            ).seriesSlug !== courseSlug
          )
            return;
          const destination = [
            ...context.chapters.flatMap((chapter) => chapter.steps),
            ...(context.references ?? []),
          ].find((item) => {
            const candidate = new URL(item.href, window.location.origin);
            return (
              candidate.pathname === target.pathname &&
              candidate.searchParams.get("placement") ===
                target.searchParams.get("placement") &&
              candidate.searchParams.get("view") ===
                target.searchParams.get("view")
            );
          });
          if (destination !== undefined)
            setIntent({ id: destination.id, courseHref: context.courseHref });
        }}
      >
        {active ? (
          <>
            <HidePublicFooter />
            <CourseRail context={navigation} />
          </>
        ) : null}
        <div className={styles["hostDocument"]}>
          {active ? (
            <ProgrammeDialog
              context={navigation}
              supplementary={
                selectedId === null
                  ? frame?.supplementaryTitle !== undefined
                  : navigation.activeReferenceId !== undefined
              }
            />
          ) : null}
          {children}
        </div>
      </div>
    </CourseReadingHostContext.Provider>
  );
}
