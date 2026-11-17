import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";
import { MaterialBodyView, type RenderedBlock } from "@/entities/material";
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
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
