import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  MaterialDeleteDialog,
  type DeleteMaterialDraftInput,
} from "@/features/material-lifecycle";
import { ProductRemovalConfirmationDialog } from "@/shared/ui/product-removal-confirmation-dialog.client";
import "../../app/globals.css";

const parameters = new URLSearchParams(location.search);
const kind = parameters.get("kind");
if (kind !== "draft" && kind !== "controlled" && kind !== "removal")
  throw new Error("Unknown deletion fixture kind");
const pending = parameters.get("pending") === "1";

function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [open, setOpen] = useState(false);
  const [confirms, setConfirms] = useState(0);
  const [cancels, setCancels] = useState(0);
  const [payload, setPayload] = useState<DeleteMaterialDraftInput | null>(null);
  const confirm = () => {
    setConfirms((count) => count + 1);
    if (confirms === 0) setVisible(false);
    else setMounted(false);
  };
  const cancel = () => {
    setCancels((count) => count + 1);
    setOpen(false);
    if (kind === "removal") setMounted(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
          setOpen(true);
        }}
      >
        Вернуть диалог
      </button>
      <output aria-label="Подтверждения">{confirms}</output>
      <output aria-label="Отмены">{cancels}</output>
      <output aria-label="Запрос">{JSON.stringify(payload)}</output>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          kind === "removal" ? (
            <ProductRemovalConfirmationDialog
              products={[
                {
                  productId: "02000000-0000-4000-8000-000000000004",
                  name: "Синтетический продукт",
                  holders: 2,
                },
              ]}
              pending={pending}
              onCancel={cancel}
              onConfirm={confirm}
            />
          ) : (
            <MaterialDeleteDialog
              contentVersion={7}
              materialId="02000000-0000-4000-8000-000000000001"
              submissionId="02000000-0000-4000-8000-000000000002"
              title="Синтетический черновик"
              pending={pending}
              result={null}
              {...(kind === "controlled" ? { open } : {})}
              onOpenChange={cancel}
              onDelete={(input) => {
                setPayload(input);
                confirm();
              }}
              primaryVideo={{
                origin: "platform_upload",
                title: "Синтетическое видео",
                videoId: "02000000-0000-4000-8000-000000000003",
              }}
            />
          )
        ) : null}
      </Activity>
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing deletion dialog fixture root");
createRoot(root).render(<App />);
