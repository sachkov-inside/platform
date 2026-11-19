import { Activity, lazy, startTransition, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  useAutosave,
  usePendingUploadGuard,
} from "../../src/shared/lib/autosave/use-autosave";

const PendingEditor = lazy(async () => {
  await fetch("/pending-editor");
  return { default: () => null };
});

function Editor({ destination }: { readonly destination: string }) {
  const [draft, setDraft] = useState("");
  const pendingRender = destination === "suspended";
  const autosave = useAutosave({
    value: pendingRender ? "uncommitted" : draft,
    enabled: !pendingRender,
    save: async (value) => {
      const response = await fetch("/save/" + destination, {
        method: "PUT",
        body: value,
      });
      if (response.status === 422) return "invalid";
      return response.ok ? "saved" : "failed";
    },
  });
  return (
    <>
      <label>
        Draft
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <output>
        {autosave.error
          ? "error"
          : autosave.pending
            ? "pending"
            : autosave.dirty
              ? "dirty"
              : "saved"}
      </output>
      <button onClick={() => void autosave.retry()}>Retry</button>
      {pendingRender && <PendingEditor />}
    </>
  );
}

function Surface() {
  const [destination, setDestination] = useState("first");
  const [visible, setVisible] = useState(true);
  const [upload, setUpload] = useState(false);
  usePendingUploadGuard(upload);
  return (
    <>
      <button onClick={() => setDestination("second")}>Change writer</button>
      <button
        onClick={() => startTransition(() => setDestination("suspended"))}
      >
        Suspend writer
      </button>
      <button onClick={() => setVisible(!visible)}>Toggle editor</button>
      <button onClick={() => setUpload(!upload)}>Toggle upload</button>
      <Suspense fallback="Loading">
        <Activity mode={visible ? "visible" : "hidden"}>
          <Editor destination={destination} />
        </Activity>
      </Suspense>
      <a href="?done">Leave</a>
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(
  location.search === "?done" ? <h1>Destination</h1> : <Surface />,
);
