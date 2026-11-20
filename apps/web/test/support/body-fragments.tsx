import {
  Activity,
  use,
  Suspense,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { flushSync } from "react-dom";
import {
  LessonSteps,
  MaterialBodyView,
  type RenderedBlock,
} from "@/entities/material";
import "../../app/globals.css";

const paragraph = (text: string): RenderedBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", marks: [], text }],
});
const blocks: readonly RenderedBlock[] = [
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        text: "Read target",
        marks: [{ kind: "link", href: "#target-section" }],
      },
    ],
  },
  ...Array.from({ length: 24 }, (_, index) =>
    paragraph(`Paragraph ${String(index + 1)} before the target.`),
  ),
  {
    kind: "heading",
    level: 2,
    content: [{ kind: "text", marks: [], text: "Target section" }],
  },
  ...Array.from({ length: 24 }, (_, index) =>
    paragraph(`Paragraph ${String(index + 1)} after the target.`),
  ),
];

function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setVisible(!visible);
        }}
      >
        {visible ? "Hide body" : "Show body"}
      </button>
      <button
        onClick={() => {
          setMounted(!mounted);
        }}
      >
        {mounted ? "Remove body" : "Remount body"}
      </button>
      {mounted ? (
        <Activity mode={visible ? "visible" : "hidden"}>
          <article className="mx-auto max-w-2xl" data-reader-body>
            <MaterialBodyView
              blocks={blocks}
              path={[]}
              rendering={{
                headingId: (path) => `legacy-${path.join("-")}`,
                image: () => null,
                file: () => null,
              }}
            />
          </article>
        </Activity>
      ) : null}
    </>
  );
}
interface AdmissionObservation {
  readonly phase: "accepted" | "intermediate" | "saved";
  readonly at: number;
  readonly openedParts?: number;
  readonly saved?: number | null;
}
const admissionObservations: AdmissionObservation[] = [];
const continuation = Promise.withResolvers<undefined>();
let admitted = false;
const admissionListeners = new Set<() => void>();
const subscribeAdmission = (listener: () => void) => {
  admissionListeners.add(listener);
  return () => {
    admissionListeners.delete(listener);
  };
};
const readAdmission = () => admitted;
const serverAdmission = () => false;

function recordAcceptedParts(openedParts: number) {
  admissionObservations.push({
    phase: "accepted",
    at: performance.now(),
    openedParts,
  });
  admitted = true;
  for (const listener of admissionListeners) listener();
}

function AwaitLessonRender({
  ready,
  children,
}: {
  readonly ready: boolean;
  readonly children: ReactNode;
}) {
  const pending = useSyncExternalStore(
    subscribeAdmission,
    readAdmission,
    serverAdmission,
  );
  if (pending && !ready) {
    use(continuation.promise);
  }
  return children;
}
const lessonBlocks: readonly RenderedBlock[] = Array.from(
  { length: 4 },
  (_, part): RenderedBlock[] => [
    {
      kind: "heading",
      level: 2,
      content: [
        {
          kind: "text",
          marks: [],
          text: part === 3 ? "Итог" : `Раздел ${String(part + 1)}`,
        },
      ],
    },
    ...Array.from({ length: 22 }, (_, index) =>
      paragraph(`Раздел ${String(part + 1)}, абзац ${String(index + 1)}.`),
    ),
    ...(part === 3
      ? []
      : [
          {
            kind: "step_break" as const,
            label: `Открыть часть ${String(part + 2)}`,
          },
        ]),
  ],
).flat();

function ControlledLessonAdmission() {
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<number | undefined>(undefined);
  const deliverProgress = () => {
    continuation.resolve(undefined);
    flushSync(() => {
      setReady(true);
    });
    const currentBody = document.querySelector("[data-controlled-lesson]");
    if (currentBody === null) throw new Error("Missing current lesson body");
    admissionObservations.push({
      phase: "intermediate",
      at: performance.now(),
      saved: saved ?? null,
      openedParts:
        1 +
        currentBody.querySelectorAll("[data-lesson-part]:not([data-closed])")
          .length,
    });
    admissionObservations.push({
      phase: "saved",
      at: performance.now(),
      saved: 3,
    });
    setSaved(3);
  };
  return (
    <>
      <button type="button" onClick={deliverProgress}>
        Доставить сохранённый прогресс
      </button>
      <output aria-label="Сохранённые части">{saved ?? "не получены"}</output>
      <Suspense
        fallback={<p role="status">Продолжение рендера ожидает готовности</p>}
      >
        <LessonSteps
          blocks={lessonBlocks}
          progress={{ saved, save: recordAcceptedParts }}
          reader={{ name: "Вы", avatar: null }}
        >
          <AwaitLessonRender ready={ready}>
            <article
              className="mx-auto max-w-2xl"
              data-reader-body
              data-controlled-lesson
            >
              <MaterialBodyView
                blocks={lessonBlocks}
                path={[]}
                rendering={{
                  headingId: (path) => `legacy-${path.join("-")}`,
                  image: () => null,
                  file: () => null,
                }}
              />
            </article>
          </AwaitLessonRender>
        </LessonSteps>
      </Suspense>
    </>
  );
}
const fragmentLink = (text: string, href: string): RenderedBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [{ kind: "link", href }] }],
});

function LessonFragmentExample({ isolated }: { readonly isolated: boolean }) {
  const [mounted, setMounted] = useState(!isolated);
  const [visible, setVisible] = useState(true);
  const [saves, setSaves] = useState<readonly number[]>([]);
  return (
    <>
      <button
        onClick={() => {
          setMounted(!mounted);
        }}
      >
        {mounted ? "Remove lesson" : "Mount lesson"}
      </button>
      <button
        onClick={() => {
          setVisible(!visible);
        }}
      >
        {visible ? "Hide lesson" : "Show lesson"}
      </button>
      <output aria-label="Saved parts">{saves.join(",")}</output>
      {isolated && (
        <>
          <a href="#lesson-target">Read lesson target</a>
          <div data-lesson-part="2" />
          <h2 id="lesson-target">Lesson target</h2>
        </>
      )}
      {mounted && (
        <Activity mode={visible ? "visible" : "hidden"}>
          <LessonSteps
            blocks={isolated ? lessonBlocks : linkedLessonBlocks}
            progress={{
              saved: null,
              save: (count) => {
                setSaves((old) => [...old, count]);
              },
            }}
            reader={{ name: "Вы", avatar: null }}
          >
            {isolated ? null : (
              <article data-reader-body>
                <MaterialBodyView
                  blocks={linkedLessonBlocks}
                  path={[]}
                  rendering={{
                    headingId: (path) => `legacy-${path.join("-")}`,
                    image: () => null,
                    file: () => null,
                  }}
                />
              </article>
            )}
          </LessonSteps>
        </Activity>
      )}
    </>
  );
}
const linkedLessonBlocks = [
  fragmentLink("Read final section", "#итог"),
  fragmentLink("Before final section", "#раздел-2"),
  ...lessonBlocks,
  fragmentLink("After final section", "#раздел-1"),
];
const root = document.getElementById("root");
if (root !== null) {
  if (new URLSearchParams(location.search).has("lesson-admission")) {
    Object.defineProperty(window, "lessonAdmissionObservations", {
      get: () => [...admissionObservations],
    });
    root.innerHTML = renderToString(<ControlledLessonAdmission />);
    hydrateRoot(root, <ControlledLessonAdmission />);
  } else if (new URLSearchParams(location.search).has("lesson-fragment")) {
    createRoot(root).render(
      <LessonFragmentExample
        isolated={new URLSearchParams(location.search).has("isolated")}
      />,
    );
  } else createRoot(root).render(<App />);
}
