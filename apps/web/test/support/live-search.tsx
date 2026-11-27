import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";

function Result({ query }: { query: string }) {
  return <output aria-label="Search query">{useLiveSearchValue(query)}</output>;
}

function Fixture() {
  const [query, setQuery] = useState("initial");
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <label>
        Draft
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <button onClick={() => setVisible(!visible)}>
        {visible ? "Hide" : "Show"}
      </button>
      <button onClick={() => setMounted(false)}>Unmount</button>
      {mounted && (
        <Activity mode={visible ? "visible" : "hidden"}>
          <Result query={query} />
        </Activity>
      )}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
