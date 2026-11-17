import { Activity, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ProfileAvatarEditor } from "@/_pages/account/ui/profile-avatar-editor.client";
import type { PrivateAccountProfile } from "@/entities/account-profile";
import "../../app/globals.css";

const resources = new Map<
  string,
  { readonly fileName: string | null; released: boolean }
>();
const realCreate = URL.createObjectURL.bind(URL);
const realRelease = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = realCreate(blob);
  resources.set(url, {
    fileName: blob instanceof File ? blob.name : null,
    released: false,
  });
  return url;
};
URL.revokeObjectURL = (url) => {
  realRelease(url);
  const acquired = resources.get(url);
  if (acquired !== undefined) acquired.released = true;
};

function resourceState() {
  return [...resources].map(([url, state]) => ({ url, ...state }));
}

const profile = {
  avatar: null,
  bio: null,
  createdAt: "2026-11-16T12:00:00.000Z",
  displayName: "Проверка аватара",
  status: "active",
  updatedAt: "2026-11-16T12:00:00.000Z",
  version: 1,
} satisfies PrivateAccountProfile;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function App() {
  const [mounted, setMounted] = useState(true);
  const [visible, setVisible] = useState(true);
  const [receipt, setReceipt] = useState<ReturnType<typeof resourceState>>([]);
  const [failure, setFailure] = useState("");

  async function selectBeforeDecode(
    mode: "leave" | "latest" | "invalid" | "cancel" | "upload",
  ) {
    const response = await fetch("/images/sachkov-dev-avatar.webp");
    if (!response.ok) throw new Error("Missing real image fixture");
    const bytes = await response.blob();
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement))
      throw new Error("Missing public avatar file input");
    const fileInput = input;
    function select(file: File) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      flushSync(() => {
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    if (mode === "cancel" || mode === "upload") {
      const dialog = document.querySelector("dialog");
      if (!(dialog instanceof HTMLDialogElement) || !dialog.open)
        throw new Error("Missing open crop before image paste");
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "pending.webp", { type: "image/webp" }),
      );
      flushSync(() => {
        dialog.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            clipboardData: transfer,
          }),
        );
      });
      const action = [...dialog.querySelectorAll("button")].find(
        (button) =>
          button.textContent ===
          (mode === "cancel" ? "Отмена" : "Сохранить аватар"),
      );
      if (action === undefined) throw new Error("Missing public crop action");
      flushSync(() => {
        action.click();
      });
    } else {
      select(new File([bytes], "first.webp", { type: "image/webp" }));
    }
    if (mode === "leave") {
      flushSync(() => {
        setMounted(false);
      });
    } else if (mode === "latest") {
      select(new File([bytes], "latest.webp", { type: "image/webp" }));
    } else if (mode === "invalid") {
      select(new File(["invalid"], "wrong.txt", { type: "text/plain" }));
    }
    const immediate = resourceState();
    flushSync(() => {
      setReceipt(immediate);
    });
  }

  return (
    <QueryClientProvider client={client}>
      <p>Сохранённый компонент, не действующая страница кабинета.</p>
      <button
        id="hide"
        type="button"
        onClick={() => {
          flushSync(() => {
            setVisible(false);
          });
          const immediate = resourceState();
          flushSync(() => {
            setReceipt(immediate);
          });
        }}
      >
        Скрыть страницу
      </button>
      <button
        id="show"
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Вернуться на страницу
      </button>
      <button
        id="unmount"
        type="button"
        onClick={() => {
          flushSync(() => {
            setMounted(false);
          });
          const immediate = resourceState();
          flushSync(() => {
            setReceipt(immediate);
          });
        }}
      >
        Уйти со страницы
      </button>
      {(["leave", "latest", "invalid", "cancel", "upload"] as const).map(
        (mode) => (
          <button
            key={mode}
            type="button"
            id={mode}
            onClick={() => {
              void selectBeforeDecode(mode).catch((error: unknown) => {
                setFailure(error instanceof Error ? error.message : "Failed");
              });
            }}
          >
            {mode}
          </button>
        ),
      )}
      <button
        id="inspect"
        type="button"
        onClick={() => {
          flushSync(() => {
            setReceipt(resourceState());
          });
        }}
      >
        Прочитать browser resources
      </button>
      <output aria-label="URL receipts">{JSON.stringify(receipt)}</output>
      <output aria-label="Harness error">{failure}</output>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <ProfileAvatarEditor
            profile={profile}
            onProfileChange={() => undefined}
          />
        ) : (
          <p>Другая страница</p>
        )}
      </Activity>
    </QueryClientProvider>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing avatar fixture root");
createRoot(root).render(<App />);
