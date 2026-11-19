import { internalRoute } from "../../src/shared/routing/internal-route";
import { Activity, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { CourseReadingHost } from "../../src/features/library-discovery/ui/course-reading-host.client";
import {
  CourseReadingLayout,
  ProgrammeDialog,
} from "../../src/features/library-discovery/ui/course-reading.client";
import { courseGuide } from "../../src/storybook/course-reading.fixtures";
import { releaseLocation } from "./course-reading-router";
import "../../app/globals.css";

const references = Array.from({ length: 10 }, (_, i) => ({
  id: `ref-${String(i)}`,
  slug: `ref-${String(i)}`,
  title: `Reference ${String(i + 1)}`,
  href: internalRoute(`/materials/ref-${String(i)}`),
}));
const steps = Array.from({ length: 30 }, (_, i) => ({
  ...courseGuide.current,
  id: `step-${String(i)}`,
  title: `Step ${String(i + 1)}`,
  href: internalRoute(`/materials/step-${String(i)}`),
}));
const context = {
  ...courseGuide,
  current:
    steps[new URLSearchParams(window.location.search).has("last") ? 29 : 0] ??
    courseGuide.current,
  currentChapterId: "first",
  chapters: [
    { id: "first", name: "First chapter", ordinal: 1, steps, references },
    {
      id: "second",
      name: "Second chapter",
      ordinal: 2,
      steps: steps.slice(0, 20),
      references,
    },
  ],
};
function DialogLifetime() {
  const [current, setCurrent] = useState(courseGuide.current);
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setCurrent({ ...current, id: "another-step" });
        }}
      >
        Change step
      </button>
      <button
        onClick={() => {
          setVisible(!visible);
        }}
      >
        Toggle lesson
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <ProgrammeDialog
          context={{ ...courseGuide, current }}
          supplementary={false}
        />
      </Activity>
    </>
  );
}

function Fixture() {
  if (new URLSearchParams(window.location.search).has("dialog-lifetime"))
    return <DialogLifetime />;
  return (
    <CourseReadingHost pathname={window.location.pathname}>
      <CourseReadingLayout context={context}>
        <h1>Reader body</h1>
        <p>Document text</p>
      </CourseReadingLayout>
    </CourseReadingHost>
  );
}
function HandoffReturn() {
  const [pathname, setPathname] = useState(window.location.pathname);
  return (
    <>
      <button
        onClick={() => {
          setPathname("/materials/another-lesson");
        }}
      >
        Leave course frame
      </button>
      <CourseReadingHost pathname={pathname}>
        <CourseReadingLayout context={context}>
          <h1>Reader body</h1>
        </CourseReadingLayout>
      </CourseReadingHost>
    </>
  );
}

function layoutContext(name: string, revision: number) {
  return {
    ...context,
    chapters: context.chapters.map((chapter, index) =>
      index === 0
        ? { ...chapter, name: name + " revision " + String(revision) }
        : chapter,
    ),
  };
}

function RetainedLayouts() {
  const [second, setSecond] = useState(false);
  const [revision, setRevision] = useState(0);
  const [layouts, setLayouts] = useState(() => [
    layoutContext("First", 0),
    layoutContext("Second", 0),
  ]);
  return (
    <>
      <button
        onClick={() => {
          const next = revision + 1;
          setSecond(!second);
          setRevision(next);
          setLayouts([
            layoutContext("First", next),
            layoutContext("Second", next),
          ]);
        }}
      >
        Switch lesson
      </button>
      <button
        onClick={() => {
          setLayouts(
            layouts.map((item, index) =>
              second !== (index === 1)
                ? layoutContext("Hidden", revision)
                : item,
            ),
          );
        }}
      >
        Update hidden lesson
      </button>
      <CourseReadingHost pathname={window.location.pathname}>
        {layouts.map((item, index) => (
          <div key={index} hidden={second !== (index === 1)}>
            <CourseReadingLayout context={item}>
              <h1>{index === 0 ? "First lesson" : "Second lesson"}</h1>
              <p>{item.chapters[0]?.name}</p>
            </CourseReadingLayout>
          </div>
        ))}
      </CourseReadingHost>
    </>
  );
}

const scenario = new URLSearchParams(window.location.search).get("scenario");
const OwnerFixture =
  scenario === "layouts"
    ? RetainedLayouts
    : scenario === "return"
      ? HandoffReturn
      : Fixture;
const root = document.getElementById("root");
if (root === null) throw new Error("Missing fixture root");
root.innerHTML = renderToString(<OwnerFixture />);
hydrateRoot(root, <OwnerFixture />, {
  onRecoverableError(error) {
    // renderToString emits the suspended observer fallback. Only this boundary switches to CSR.
    if (
      !(error instanceof Error) ||
      !error.message.includes('The server used "renderToString"')
    )
      throw error;
  },
});
document.getElementById("release")?.addEventListener("click", releaseLocation);
