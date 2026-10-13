"use client";

import { Copy, Download, FileText, Folder, List, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/shared/ui/button";

/** Synthetic attachment presentation only; no production route imports this proof. */
export interface AttachmentProofFile {
  readonly path: string;
  readonly text?: string;
  readonly downloadHref: string;
}

interface FileGroup {
  readonly name: string;
  readonly files: AttachmentProofFile[];
  readonly groups: Map<string, FileGroup>;
}

export function MaterialAttachmentViewerProof({
  files,
  bundleHref,
  initiallyOpen = false,
}: {
  readonly files: readonly AttachmentProofFile[];
  readonly bundleHref: string;
  readonly initiallyOpen?: boolean;
}) {
  const [opened, setOpened] = useState(initiallyOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpened(true);
        }}
        className="inline items-baseline rounded-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <FileText
          aria-hidden="true"
          className="mr-1 inline size-4 align-[-0.15em]"
        />
        файлы к этому материалу
      </button>
      {opened
        ? createPortal(
            <AttachmentWindow
              files={files}
              bundleHref={bundleHref}
              onClose={() => {
                setOpened(false);
                trigger.current?.focus({ preventScroll: true });
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function AttachmentWindow({
  files,
  bundleHref,
  onClose,
}: {
  readonly files: readonly AttachmentProofFile[];
  readonly bundleHref: string;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [selectedPath, setSelectedPath] = useState(files[0]?.path);
  const [showFiles, setShowFiles] = useState(false);
  const [feedback, setFeedback] = useState("");
  const selected = files.find((file) => file.path === selectedPath) ?? files[0];
  const root: FileGroup = { name: "", files: [], groups: new Map() };
  for (const file of files) {
    const directories = file.path.split("/").slice(0, -1);
    let group = root;
    for (const directory of directories) {
      let child = group.groups.get(directory);
      if (child === undefined) {
        child = { name: directory, files: [], groups: new Map() };
        group.groups.set(directory, child);
      }
      group = child;
    }
    group.files.push(file);
  }

  useEffect(() => {
    const element = dialog.current;
    const bodyOverflow = document.body.style.overflow;
    const scroller = document.querySelector<HTMLElement>(
      "[data-application-content]",
    );
    const overflow = scroller?.style.overflow ?? "";
    document.body.style.overflow = "hidden";
    if (scroller !== null) scroller.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = bodyOverflow;
      if (scroller !== null) scroller.style.overflow = overflow;
    };
  }, []);

  function select(path: string) {
    setSelectedPath(path);
    setFeedback("");
    setShowFiles(false);
  }

  function renderGroup(group: FileGroup) {
    const list = (
      <ul className="space-y-1">
        {group.files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              aria-pressed={selected?.path === file.path}
              onClick={() => {
                select(file.path);
              }}
              className={`flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring ${selected?.path === file.path ? "bg-secondary font-medium" : "hover:bg-muted"}`}
            >
              <FileText
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span className="break-words [overflow-wrap:anywhere]">
                {file.path.split("/").at(-1)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );

    const children = (
      <>
        {list}
        {[...group.groups.values()].map((child) => (
          <details open key={child.name} className="mt-3">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
              <Folder aria-hidden="true" className="size-4 shrink-0" />
              {child.name}
            </summary>
            <div className="ml-3 border-l border-border pl-2">
              {renderGroup(child)}
            </div>
          </details>
        ))}
      </>
    );
    return children;
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      closedby="any"
      onClose={onClose}
      className="fixed inset-0 m-auto h-dvh max-h-dvh w-full max-w-none overflow-hidden bg-background p-0 text-foreground backdrop:bg-foreground/40 sm:h-[min(48rem,90dvh)] sm:max-w-5xl sm:rounded-xl"
      onClick={(event) => {
        if (
          "closedBy" in HTMLDialogElement.prototype ||
          event.target !== event.currentTarget
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          event.currentTarget.close();
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id={title} className="text-base font-semibold">
              Файлы материала
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Файлов: {String(files.length)} · можно читать и копировать
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Закрыть просмотр файлов"
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex shrink-0 flex-col border-b border-border md:w-60 md:border-b-0 md:border-r">
            <Button
              variant="ghost"
              className="min-h-11 justify-start rounded-none md:hidden"
              aria-expanded={showFiles}
              onClick={() => {
                setShowFiles(!showFiles);
              }}
            >
              <List aria-hidden="true" />
              {showFiles ? "Скрыть список файлов" : "Выбрать файл"}
            </Button>
            <nav
              aria-label="Вложенные файлы"
              className={`${showFiles ? "block" : "hidden"} max-h-[35dvh] overflow-auto p-3 md:block md:max-h-none md:flex-1`}
            >
              {renderGroup(root)}
            </nav>
            {files.length > 1 ? (
              <a
                className="hidden min-h-11 items-center gap-2 border-t border-border px-4 text-sm font-medium underline underline-offset-4 md:flex"
                href={bundleHref}
                download="material-files.zip"
              >
                <Download aria-hidden="true" className="size-4" />
                Скачать все ZIP
              </a>
            ) : null}
          </aside>
          <section
            aria-label="Содержимое выбранного файла"
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {selected === undefined ? (
              <p className="p-5">Файлов пока нет.</p>
            ) : (
              <>
                <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
                  <h3 className="break-words font-mono text-sm font-medium [overflow-wrap:anywhere]">
                    {selected.path}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {selected.text === undefined ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(selected.text ?? "")
                            .then(() => {
                              setFeedback("Содержимое скопировано");
                            })
                            .catch(() => {
                              setFeedback(
                                "Не удалось скопировать. Выделите текст вручную.",
                              );
                            });
                        }}
                      >
                        <Copy aria-hidden="true" />
                        Копировать
                      </Button>
                    )}
                    <a
                      className="inline-flex min-h-11 items-center gap-2 px-2 text-sm underline underline-offset-4"
                      href={selected.downloadHref}
                      download={selected.path.split("/").at(-1)}
                    >
                      <Download aria-hidden="true" className="size-4" />
                      Скачать файл
                    </a>
                    {files.length > 1 ? (
                      <a
                        className="inline-flex min-h-11 items-center gap-2 px-2 text-sm underline underline-offset-4 md:hidden"
                        href={bundleHref}
                        download="material-files.zip"
                      >
                        Все файлы ZIP
                      </a>
                    ) : null}
                  </div>
                  <p
                    role="status"
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    {feedback}
                  </p>
                </div>
                {selected.text === undefined ? (
                  <div className="p-5 text-sm leading-6">
                    <p className="font-medium">
                      Для этого файла нет предпросмотра
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      Скачайте файл и откройте его в подходящем приложении.
                    </p>
                  </div>
                ) : (
                  <pre
                    key={selected.path}
                    tabIndex={0}
                    aria-label={`Содержимое ${selected.path}`}
                    className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [overflow-wrap:anywhere] sm:p-5"
                  >
                    {selected.text}
                  </pre>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}
