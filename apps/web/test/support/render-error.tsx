import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useRenderErrorReport } from "@/features/client-telemetry";

function Fixture() {
  const [error, setError] = useState(() => new Error("First"));
  const [publicBoundary, setPublicBoundary] = useState(false);
  const [render, setRender] = useState(0);
  const retry = () => setRender((count) => count + 1);
  useRenderErrorReport(publicBoundary ? "public" : "root", error);
  return (
    <>
      <output aria-label="Render count">{render}</output>
      <button onClick={retry}>Render again</button>
      <button onClick={() => setError(new Error("Next"))}>Replace error</button>
      <button onClick={() => setPublicBoundary(true)}>
        Use public boundary
      </button>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
