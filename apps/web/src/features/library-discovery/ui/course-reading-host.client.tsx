"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
  const [location, setLocation] = useState<CourseLocation | null>(null);
  const publish = useCallback((next: CourseFramePublication) => {
    setFrame((previous) =>
      previous?.context === next.context &&
      previous.supplementaryTitle === next.supplementaryTitle &&
      previous.pathname === next.pathname
        ? previous
        : next,
    );
  }, []);
  const context = frame?.context;
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
    context != null &&
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
      >
        {active ? (
          <>
            <HidePublicFooter />
            <CourseRail context={context} />
          </>
        ) : null}
        <div className={styles["hostDocument"]}>
          {active ? (
            <ProgrammeDialog
              context={context}
              supplementary={frame?.supplementaryTitle !== undefined}
            />
          ) : null}
          {children}
        </div>
      </div>
    </CourseReadingHostContext.Provider>
  );
}
