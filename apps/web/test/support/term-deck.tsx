import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";
import { LessonTermDeck } from "@/features/lesson-term-deck";
import "../../app/globals.css";

const terms = [
  {
    id: "alpha",
    title: "Альфа",
    englishTitle: null,
    shortDefinition: "Определение альфы.",
    fullDefinition: "Первое определение.",
  },
  {
    id: "beta",
    title: "Бета",
    englishTitle: null,
    shortDefinition: "Определение беты.",
    fullDefinition: "Второе определение.",
  },
  {
    id: "gamma",
    title: "Гамма",
    englishTitle: null,
    shortDefinition: "Определение гаммы.",
    fullDefinition: "Третье определение.",
  },
];

function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [single, setSingle] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setVisible(!visible);
        }}
      >
        {visible ? "Hide" : "Show"}
      </button>
      <button
        onClick={() => {
          setMounted(!mounted);
        }}
      >
        {mounted ? "Remove" : "Remount"}
      </button>
      <button
        onClick={() => {
          setSingle(!single);
        }}
      >
        {single ? "All terms" : "One term"}
      </button>
      <main className="mx-auto max-w-2xl">
        {mounted ? (
          <Activity mode={visible ? "visible" : "hidden"}>
            <LessonTermDeck terms={single ? terms.slice(0, 1) : terms} />
          </Activity>
        ) : null}
      </main>
    </>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
