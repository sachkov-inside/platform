import "../../../../../app/globals.css";
import { Activity, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/core";
import { MaterialAuthoringWorkspace } from "../../index";
import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
} from "../../index";

const noop = () => {
  /* The harness supplies inert public actions outside these scenarios. */
};
const initial: MaterialAuthoringPresentation = {
  authorization: { kind: "allowed" },
  blocking: { kind: "none" },
  availableFormats: [],
  availableProduct: [],
  availableTags: [],
  availableTopics: [],
  deletion: { pending: false, result: null },
  noticeRevision: 0,
  save: { kind: "clean" },
  submissionId: "lifetime-proof",
  validation: { kind: "idle" },
  draft: {
    access: "free",
    canDelete: false,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before upload" }],
        },
      ],
    },
    deleteVideoId: null,
    detachVideoIds: [],
    difficulty: "unassigned",
    formatId: "",
    outcomes: [],
    materialId: "02000000-0000-4000-8000-000000000010",
    latestVideoDeletion: null,
    primaryVideo: null,
    primaryVideoId: null,
    contentVersion: 1,
    readOnly: false,
    productIds: [],
    status: "draft",
    summary: "",
    tagIds: [],
    title: "Lifetime proof",
    topicId: "",
    unselectedVideoUpload: null,
  },
};
function Harness() {
  const [client] = useState(() => new QueryClient());
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [presentation, setPresentation] = useState(initial);
  const documentChanged = useCallback((document: JSONContent) => {
    setPresentation((current) => ({
      ...current,
      draft: { ...current.draft, document },
    }));
  }, []);
  const actions: MaterialAuthoringActions = {
    onBack: noop,
    onCancelProductRemoval: noop,
    onConfirmProductRemoval: noop,
    onConflictAction: noop,
    onDocumentChange: documentChanged,
    onDelete: noop,
    onFieldChange: noop,
    onOpenPreview: noop,
    onOutcomesChange: noop,
    onPrimaryVideoChange: noop,
    onRetry: noop,
    onReturnToEditor: noop,
    onSave: noop,
    onProductToggle: noop,
    onTagToggle: noop,
  };
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
          setPresentation((value) => ({
            ...value,
            draft: { ...value.draft, readOnly: !value.draft.readOnly },
          }));
        }}
      >
        Toggle readonly
      </button>
      <button
        onClick={() => {
          setPresentation((value) => ({
            ...value,
            draft: {
              ...value.draft,
              materialId: "02000000-0000-4000-8000-000000000011",
            },
          }));
        }}
      >
        Switch Material
      </button>
      <output aria-label="Document">
        {JSON.stringify(presentation.draft.document)}
      </output>
      {mounted ? (
        <Activity mode={visible ? "visible" : "hidden"}>
          <MaterialAuthoringWorkspace
            presentation={presentation}
            actions={actions}
          />
        </Activity>
      ) : null}
    </QueryClientProvider>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<Harness />);
