import { Activity, useState, useSyncExternalStore } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ReadingProgressProvider,
  useLessonOpenedParts,
} from "@/features/reading-progress";
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
const subscribeAccount = () => () => undefined;
const resolvedAccount = () => true;
const serverAccount = () => false;
const queryClient = new QueryClient();
const materialId = "02000000-0000-4000-8000-000000002479";

function HydratingReader() {
  const resolved = useSyncExternalStore(
    subscribeAccount,
    resolvedAccount,
    serverAccount,
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ReadingProgressProvider accountId={null} resolved={resolved}>
        <HydratingLesson />
      </ReadingProgressProvider>
    </QueryClientProvider>
  );
}

/** Real hydration admits the initial hash before the external progress snapshot is published. */
function HydratingLesson() {
  const progress = useLessonOpenedParts(materialId);
  return (
    <LessonSteps
      blocks={lessonBlocks}
      progress={progress}
      reader={{ name: "Вы", avatar: null }}
    >
      <article className="mx-auto max-w-2xl" data-reader-body>
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
    </LessonSteps>
  );
}
const root = document.getElementById("root");
if (root !== null) {
  if (new URLSearchParams(location.search).has("hydrate-lesson")) {
    root.innerHTML = renderToString(<HydratingReader />);
    hydrateRoot(root, <HydratingReader />);
  } else createRoot(root).render(<App />);
}
