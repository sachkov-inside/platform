import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaterialVideoAuthoring } from "../material-video-authoring.client";
import type { MaterialAuthoringVideo } from "../../model/video";

function Harness() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
  );
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const [changes, setChanges] = useState<readonly unknown[]>([]);
  const adopted: MaterialAuthoringVideo | null =
    location.search === "?adopted"
      ? {
          origin: "platform_upload",
          protected: true,
          state: "processing",
          title: "Adopted upload",
          videoId: "03000000-0000-4000-8000-000000000001",
        }
      : null;
  return (
    <QueryClientProvider client={client}>
      <button
        onClick={() => {
          setVisible((value) => !value);
        }}
      >
        Toggle visibility
      </button>
      <button
        onClick={() => {
          setMounted((value) => !value);
        }}
      >
        Toggle mount
      </button>
      <button
        onClick={() => {
          setRevision((value) => value + 1);
        }}
      >
        Refresh props
      </button>
      <output aria-label="Changes">{JSON.stringify(changes)}</output>
      <output aria-label="Revision">{revision}</output>
      {mounted ? (
        <Activity mode={visible ? "visible" : "hidden"}>
          <MaterialVideoAuthoring
            access="closed"
            deleteVideoId={null}
            disabled={false}
            latestVideoDeletion={null}
            materialId="02000000-0000-4000-8000-000000000010"
            primaryVideo={null}
            unselectedUpload={adopted}
            onChange={(...change) => {
              setChanges((current) => [...current, change]);
            }}
          />
        </Activity>
      ) : null}
    </QueryClientProvider>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<Harness />);
