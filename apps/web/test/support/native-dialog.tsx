import { Activity, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { AdminDialog } from "@/shared/ui/admin/admin-dialog.client";
import "../../app/globals.css";

function App() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("Черновик");
  return (
    <>
      <label>
        Операция выполняется
        <input
          type="checkbox"
          checked={pending}
          onChange={(event) => {
            setPending(event.currentTarget.checked);
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
          setOpen(true);
        }}
      >
        Вернуться к форме
      </button>
      <output aria-label="Состояние формы">
        {open ? "Открыта" : "Закрыта"}
      </output>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <AdminDialog
            open={open}
            pending={pending}
            onOpenChange={setOpen}
            title="Сохранённая форма"
          >
            <label>
              Название
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setVisible(false);
              }}
            >
              Другая страница
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(false);
              }}
            >
              Операция завершилась
            </button>
            <button
              type="button"
              onClick={() => {
                setMounted(false);
              }}
            >
              Удалить форму
            </button>
            <button
              type="button"
              onClick={() => {
                flushSync(() => {
                  setVisible(false);
                });
                flushSync(() => {
                  setVisible(true);
                });
                flushSync(() => {
                  setVisible(false);
                });
              }}
            >
              Два перехода
            </button>
          </AdminDialog>
        ) : null}
      </Activity>
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing native dialog root");
createRoot(root).render(<App />);
