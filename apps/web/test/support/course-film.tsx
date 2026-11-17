import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";
import { CourseFilm } from "@/features/ai-engineering-course";
import "../../app/globals.css";

function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [autoplay, setAutoplay] = useState(false);
  const [height, setHeight] = useState(200);
  const [offscreen, setOffscreen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setHeight(320);
        }}
      >
        Tall slot
      </button>
      <button
        onClick={() => {
          setAutoplay((value) => !value);
        }}
      >
        Toggle motion
      </button>
      <button
        onClick={() => {
          setVisible((value) => !value);
        }}
      >
        Toggle visibility
      </button>
      <button
        onClick={() => {
          setMounted(false);
        }}
      >
        Remove film
      </button>
      <button
        onClick={() => {
          setOffscreen((value) => !value);
        }}
      >
        Toggle offscreen
      </button>
      <style>{".film-slot > .aie-film {width:100%;height:100%}"}</style>
      <div
        className="film-slot"
        style={{ width: 320, height, marginTop: offscreen ? 2000 : 0 }}
      >
        {mounted ? (
          <Activity mode={visible ? "visible" : "hidden"}>
            <CourseFilm autoplay={autoplay} />
          </Activity>
        ) : null}
      </div>
    </>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
