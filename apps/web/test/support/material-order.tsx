import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";

import { MaterialOrder } from "@/entities/material/ui/material-blocks/material-match-order.client";
import "../../app/globals.css";

const steps = [
  { id: "split", label: "Нарезать документы на чанки" },
  { id: "embed", label: "Посчитать эмбеддинги чанков" },
  { id: "store", label: "Сохранить векторы в индекс" },
  { id: "search", label: "Найти ближайшие чанки к вопросу" },
];

function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
        }}
      >
        Hide exercise
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Return exercise
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Remove exercise
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(true);
        }}
      >
        Mount exercise
      </button>
      <main className="mx-auto max-w-3xl p-3">
        {mounted ? (
          <Activity mode={visible ? "visible" : "hidden"}>
            <MaterialOrder
              id="rag-pipeline"
              heading="Упражнение 2 из 3"
              question="Расставь шаги RAG по порядку."
              steps={steps.map((step) => ({
                ...step,
                content: step.label,
                explanation: "Шаг RAG.",
              }))}
            />
          </Activity>
        ) : null}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
