import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";

import { AiFirstProcessArtwork } from "@/features/ai-first-product";
import type { ProcessArtworkOptions } from "@/features/ai-first-product/ui/process-artwork-clock";
import "../../app/globals.css";

function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [offscreen, setOffscreen] = useState(false);
  const [options, setOptions] = useState<ProcessArtworkOptions>({
    mode: "animated",
    loop: true,
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
        }}
      >
        Hide artwork
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Return artwork
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Remove artwork
      </button>
      <button
        type="button"
        onClick={() => {
          setOffscreen(true);
        }}
      >
        Move offscreen
      </button>
      <button
        type="button"
        onClick={() => {
          setOffscreen(false);
        }}
      >
        Restore artwork
      </button>
      <button
        type="button"
        onClick={() => {
          setOptions({ mode: "static", scene: 2 });
        }}
      >
        Static scene 2
      </button>
      <button
        type="button"
        onClick={() => {
          setOptions({ mode: "static", scene: 4 });
        }}
      >
        Static scene 4
      </button>
      <button
        type="button"
        onClick={() => {
          setOptions({ mode: "animated", loop: false });
        }}
      >
        Animate once
      </button>
      <div style={{ width: 512, height: 432, marginTop: offscreen ? 2000 : 0 }}>
        {mounted ? (
          <Activity mode={visible ? "visible" : "hidden"}>
            <AiFirstProcessArtwork {...options} />
          </Activity>
        ) : null}
      </div>
    </>
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
