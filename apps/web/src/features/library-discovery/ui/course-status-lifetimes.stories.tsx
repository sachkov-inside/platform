import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, waitFor } from "storybook/test";

import { MaterialReadingScope } from "@/entities/material";
import { withDeferredTaskStatuses } from "@/features/library-discovery";
import {
  courseGuide,
  taskOnlyCourse,
} from "@/storybook/course-reading.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  CourseRail,
  CourseReadingLayout,
  CourseTaskSubmissionStatuses,
} from "./course-reading.client";

const meta = {
  ...publicPageEnvironment("/materials/course-intro"),
  title: "Patterns/Product/Course status ownership",
};
export default meta;

function scenario(canvas: HTMLElement) {
  const host = canvas.appendChild(document.createElement("div"));
  const root = createRoot(host);
  return {
    show(children: ReactNode) {
      flushSync(() => root.render(children));
    },
    close() {
      root.unmount();
      host.remove();
    },
  };
}

export const PrivateTaskStatusBelongsToItsLayout = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const view = scenario(canvasElement);
    const course = withDeferredTaskStatuses(taskOnlyCourse);
    const reading = readingOwner().value;
    const submitted = [course.current.id];
    const pending: readonly string[] = [];
    function layout(key: string, href: string | null, ids: readonly string[]) {
      return (
        <section key={key} aria-label={key}>
          <MaterialReadingScope value={reading}>
            <CourseReadingLayout context={course}>
              {href !== null && (
                <CourseTaskSubmissionStatuses
                  courseHref={href}
                  submittedTaskIds={ids}
                />
              )}
            </CourseReadingLayout>
          </MaterialReadingScope>
        </section>
      );
    }
    const status = (label: string) =>
      canvasElement
        .querySelector(
          'section[aria-label="' + label + '"] a[aria-current="step"]',
        )
        ?.getAttribute("data-progress");
    const right = layout("second", course.courseHref, submitted);
    try {
      view.show([layout("first", null, submitted), right]);
      await waitFor(() =>
        expect([status("first"), status("second")]).toEqual([
          "unknown",
          "done",
        ]),
      );
      view.show([layout("first", course.courseHref, submitted), right]);
      await waitFor(() => expect(status("first")).toBe("done"));
      view.show([layout("first", course.courseHref, pending), right]);
      await waitFor(() => expect(status("first")).toBe("todo"));
      view.show([
        layout("first", "/products/other/programme", submitted),
        right,
      ]);
      await waitFor(() =>
        expect([status("first"), status("second")]).toEqual([
          "unknown",
          "done",
        ]),
      );
      view.show([layout("first", course.courseHref, submitted), right]);
      await waitFor(() => expect(status("first")).toBe("done"));
      view.show([layout("first", null, submitted), right]);
      await waitFor(() =>
        expect([status("first"), status("second")]).toEqual([
          "unknown",
          "done",
        ]),
      );
    } finally {
      view.close();
    }
  },
};

function readingOwner() {
  const active = new Set<{ id: string }>();
  return {
    value: {
      accountId: "reader",
      resolved: true,
      states: new Map(),
      failed: false,
      register(id: string) {
        const lease = { id };
        active.add(lease);
        return () => {
          active.delete(lease);
        };
      },
      refresh: () => Promise.resolve(),
    },
    materials: () => [...active].map((lease) => lease.id).sort(),
  };
}

export const ReadingDemandFollowsTheCurrentProvider = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const chapter = courseGuide.chapters[0];
    const step = chapter?.steps.find((item) => item.materialId !== undefined);
    if (!chapter || !step) throw new Error("Expected a lesson in the course");
    const [a, b] = ["material-a", "material-b"] as const;
    const course = (ids: readonly string[]) => ({
      ...courseGuide,
      chapters: [
        {
          ...chapter,
          steps: ids.map((materialId, i) => ({
            ...step,
            id: "lesson-" + String(i),
            materialId,
          })),
        },
      ],
    });
    const left = course([a, a, b]),
      right = course([b]);
    const first = readingOwner(),
      second = readingOwner();
    const view = scenario(canvasElement);
    function show(
      owner: ReturnType<typeof readingOwner>,
      both: boolean,
      single = right,
    ) {
      view.show(
        <MaterialReadingScope value={owner.value}>
          {both && <CourseRail variant="sheet" context={left} />}
          <CourseRail variant="sheet" context={single} />
        </MaterialReadingScope>,
      );
    }
    try {
      show(first, true);
      await expect(first.materials()).toEqual([a, b, b]);
      const rail = canvasElement.querySelectorAll("button[aria-expanded]")[1];
      await expect(rail).toBeTruthy();
      show(second, true);
      await expect(
        canvasElement.querySelectorAll("button[aria-expanded]")[1],
      ).toBe(rail);
      await expect(first.materials()).toEqual([]);
      await expect(second.materials()).toEqual([a, b, b]);
      show(second, false);
      await expect(second.materials()).toEqual([b]);
      show(second, false, course([a]));
      await expect(second.materials()).toEqual([a]);
      view.show(null);
      await expect(second.materials()).toEqual([]);
    } finally {
      view.close();
    }
  },
};
