import { internalRoute } from "../../src/shared/routing/internal-route";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { CourseReadingHost } from "../../src/features/library-discovery/ui/course-reading-host.client";
import { CourseReadingLayout } from "../../src/features/library-discovery/ui/course-reading.client";
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
  current: steps[0] ?? courseGuide.current,
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
function Fixture() {
  return (
    <CourseReadingHost pathname={window.location.pathname}>
      <CourseReadingLayout context={context}>
        <h1>Reader body</h1>
        <p>Document text</p>
      </CourseReadingLayout>
    </CourseReadingHost>
  );
}
const root = document.getElementById("root");
if (root === null) throw new Error("Missing fixture root");
root.innerHTML = renderToString(<Fixture />);
hydrateRoot(root, <Fixture />, {
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
