"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileUp, Link2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  createGuideArtifactFromFile,
  createGuideArtifactFromLink,
  guideArtifactsQueryOptions,
  removeGuideArtifact,
  replaceGuideArtifactFile,
  replaceGuideArtifactLink,
  reusableGuideArtifactsQueryOptions,
  setGuideArtifactArchived,
  setGuideArtifactGuides,
  updateGuideArtifact,
  type GuideArtifactMetadataDraft,
} from "../api/guide-artifacts.browser";
import {
  describeArtifactAccess,
  describeArtifactContent,
  guidesInWords,
  type GuideArtifact,
  type GuideArtifactAccess,
  type GuideArtifactMutationResult,
} from "../model/guide-artifacts";

type Draft = GuideArtifactMetadataDraft & { readonly externalUrl: string };

const emptyDraft: Draft = {
  access: "membership",
  externalUrl: "",
  purpose: "",
  title: "",
};

export function GuideArtifactsPanel({
  archived,
  guideId,
}: {
  readonly archived: boolean;
  readonly guideId: string;
}) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const query = useQuery(guideArtifactsQueryOptions(guideId));
  const [notice, setNotice] = useState<GuideArtifactMutationResult | null>(null);

  function applyResult(result: GuideArtifactMutationResult) {
    setNotice(result);
    if (result.kind === "saved" || result.kind === "removed") {
      void queryClient.invalidateQueries({ queryKey: ["guide-artifacts"] });
    }
  }

  return (
    <section aria-labelledby={headingId} className="border-t border-border py-8">
      <h2 className="text-xl font-semibold tracking-tight" id={headingId}>
        Артефакты
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Шаблоны, конфигурации и чек-листы, которые читатель забирает себе. Один
        артефакт можно использовать в нескольких руководствах: запись остаётся
        общей, копии не создаются.
      </p>

      {archived ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Руководство в архиве. Читатели не видят его артефакты.
        </p>
      ) : null}

      <AddArtifact guideId={guideId} onResult={applyResult} />

      <div aria-live="polite" className="mt-4 min-h-6 text-sm">
        {notice === null ? null : <MutationNotice result={notice} />}
      </div>

      {query.isPending ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Загружаем артефакты…
        </p>
      ) : query.data?.kind === "ready" ? (
        <ArtifactList
          artifacts={query.data.artifacts}
          guideId={guideId}
          onResult={applyResult}
        />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3" role="alert">
          <span className="text-sm">Не удалось загрузить артефакты.</span>
          <Button
            onClick={() => {
              void query.refetch();
            }}
            type="button"
            variant="outline"
          >
            Повторить
          </Button>
        </div>
      )}
    </section>
  );
}

function ArtifactList({
  artifacts,
  guideId,
  onResult,
}: {
  readonly artifacts: readonly GuideArtifact[];
  readonly guideId: string;
  readonly onResult: (result: GuideArtifactMutationResult) => void;
}) {
  if (artifacts.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Пока ни одного артефакта. Добавьте файл или ссылку.
      </p>
    );
  }
  return (
    <ul className="mt-4 grid gap-4 md:grid-cols-2">
      {artifacts.map((artifact) => (
        <ArtifactCard
          artifact={artifact}
          guideId={guideId}
          key={artifact.artifactId}
          onResult={onResult}
        />
      ))}
    </ul>
  );
}

function ArtifactCard({
  artifact,
  guideId,
  onResult,
}: {
  readonly artifact: GuideArtifact;
  readonly guideId: string;
  readonly onResult: (result: GuideArtifactMutationResult) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [replacingLink, setReplacingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState(
    artifact.content.kind === "link" ? artifact.content.externalUrl : "",
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const otherGuides = artifact.guideIds.filter((id) => id !== guideId).length;

  const save = useMutation({
    mutationFn: (metadata: GuideArtifactMetadataDraft) =>
      updateGuideArtifact({ artifactId: artifact.artifactId, metadata }),
    onSuccess: (result) => {
      onResult(result);
      if (result.kind === "saved") setEditing(false);
    },
  });
  const replaceFile = useMutation({
    mutationFn: (file: File) =>
      replaceGuideArtifactFile({ artifactId: artifact.artifactId, file }),
    onSuccess: onResult,
  });
  const replaceLink = useMutation({
    mutationFn: (externalUrl: string) =>
      replaceGuideArtifactLink({ artifactId: artifact.artifactId, externalUrl }),
    onSuccess: onResult,
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      setGuideArtifactArchived({ archived, artifactId: artifact.artifactId }),
    onSuccess: onResult,
  });
  const detach = useMutation({
    mutationFn: () =>
      setGuideArtifactGuides({
        artifactId: artifact.artifactId,
        guideIds: artifact.guideIds.filter((id) => id !== guideId),
      }),
    onSuccess: onResult,
  });
  const remove = useMutation({
    mutationFn: () => removeGuideArtifact({ artifactId: artifact.artifactId }),
    onSuccess: onResult,
  });
  const pending =
    save.isPending ||
    replaceFile.isPending ||
    replaceLink.isPending ||
    archive.isPending ||
    detach.isPending ||
    remove.isPending;

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-medium">{artifact.title}</h3>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {describeArtifactAccess(artifact.access)}
        </span>
      </div>
      {artifact.purpose === "" ? null : (
        <p className="mt-1 text-sm text-muted-foreground">{artifact.purpose}</p>
      )}
      <p className="mt-2 break-all text-xs text-muted-foreground">
        {describeArtifactContent(artifact)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Версия {artifact.version} · обновлён{" "}
        {new Date(artifact.updatedAt).toLocaleDateString("ru-RU")}
        {artifact.origin === "authoring" ? " · из авторской базы" : ""}
        {otherGuides > 0 ? ` · ещё в ${guidesInWords(otherGuides)}` : ""}
        {artifact.archived ? " · в архиве" : ""}
      </p>

      {editing ? (
        <MetadataForm
          initial={{
            access: artifact.access,
            externalUrl: "",
            purpose: artifact.purpose,
            title: artifact.title,
          }}
          label="Изменение артефакта"
          onCancel={() => {
            setEditing(false);
          }}
          onSubmit={(draft) => {
            save.mutate({
              access: draft.access,
              purpose: draft.purpose,
              title: draft.title,
            });
          }}
          pending={save.isPending}
          submitLabel="Сохранить"
        />
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() => {
            setEditing((value) => !value);
          }}
          type="button"
          variant="outline"
        >
          {editing ? "Свернуть" : "Изменить"}
        </Button>
        {artifact.content.kind === "file" ? (
          <>
            <Button
              disabled={pending}
              onClick={() => fileInput.current?.click()}
              type="button"
              variant="outline"
            >
              <FileUp aria-hidden="true" />
              Заменить файл
            </Button>
            <input
              aria-label={`Заменить файл артефакта «${artifact.title}»`}
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) replaceFile.mutate(file);
              }}
              ref={fileInput}
              type="file"
            />
          </>
        ) : (
          <Button
            disabled={pending}
            onClick={() => {
              setReplacingLink((value) => !value);
            }}
            type="button"
            variant="outline"
          >
            <Link2 aria-hidden="true" />
            Заменить ссылку
          </Button>
        )}
        <Button
          disabled={pending}
          onClick={() => {
            archive.mutate(!artifact.archived);
          }}
          type="button"
          variant="ghost"
        >
          {artifact.archived ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <Archive aria-hidden="true" />
          )}
          {artifact.archived ? "Вернуть из архива" : "В архив"}
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            detach.mutate();
          }}
          type="button"
          variant="ghost"
        >
          Убрать из руководства
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            remove.mutate();
          }}
          type="button"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
          Удалить совсем
        </Button>
      </div>

      {artifact.content.kind === "link" && replacingLink ? (
        <form
          aria-label={`Заменить ссылку артефакта «${artifact.title}»`}
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            replaceLink.mutate(linkDraft);
          }}
        >
          <label className="flex-1">
            <span className="text-xs text-muted-foreground">Новый адрес</span>
            <input
              className="mt-1 block w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
              inputMode="url"
              onChange={(event) => {
                setLinkDraft(event.currentTarget.value);
              }}
              required
              type="url"
              value={linkDraft}
            />
          </label>
          <Button disabled={pending} type="submit" variant="outline">
            Сохранить адрес
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function AddArtifact({
  guideId,
  onResult,
}: {
  readonly guideId: string;
  readonly onResult: (result: GuideArtifactMutationResult) => void;
}) {
  const [mode, setMode] = useState<"file" | "link" | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reusable = useQuery({
    ...reusableGuideArtifactsQueryOptions(),
    enabled: mode === null,
  });

  const addFile = useMutation({
    mutationFn: (input: { file: File; metadata: GuideArtifactMetadataDraft }) =>
      createGuideArtifactFromFile({ ...input, guideId }),
    onSuccess: (result) => {
      onResult(result);
      if (result.kind === "saved") {
        setMode(null);
        setPendingFile(null);
      }
    },
  });
  const addLink = useMutation({
    mutationFn: (draft: Draft) =>
      createGuideArtifactFromLink({
        externalUrl: draft.externalUrl,
        guideId,
        metadata: {
          access: draft.access,
          purpose: draft.purpose,
          title: draft.title,
        },
      }),
    onSuccess: (result) => {
      onResult(result);
      if (result.kind === "saved") setMode(null);
    },
  });
  const reuse = useMutation({
    mutationFn: (artifact: GuideArtifact) =>
      setGuideArtifactGuides({
        artifactId: artifact.artifactId,
        guideIds: [...new Set([...artifact.guideIds, guideId])],
      }),
    onSuccess: onResult,
  });

  const candidates =
    reusable.data?.kind === "ready"
      ? reusable.data.artifacts.filter(
          (artifact) => !artifact.guideIds.includes(guideId),
        )
      : [];

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setMode(null);
            fileInput.current?.click();
          }}
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" />
          Добавить файл
        </Button>
        <input
          aria-label="Файл нового артефакта"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            setPendingFile(file);
            setMode(file === null ? null : "file");
          }}
          ref={fileInput}
          type="file"
        />
        <Button
          onClick={() => {
            setPendingFile(null);
            setMode((value) => (value === "link" ? null : "link"));
          }}
          type="button"
          variant="outline"
        >
          <Link2 aria-hidden="true" />
          Добавить ссылку
        </Button>
      </div>

      {mode === "file" && pendingFile !== null ? (
        <MetadataForm
          hint={`Файл: ${pendingFile.name}`}
          initial={{ ...emptyDraft, title: pendingFile.name }}
          label="Новый артефакт из файла"
          onCancel={() => {
            setMode(null);
            setPendingFile(null);
          }}
          onSubmit={(draft) => {
            addFile.mutate({
              file: pendingFile,
              metadata: {
                access: draft.access,
                purpose: draft.purpose,
                title: draft.title,
              },
            });
          }}
          pending={addFile.isPending}
          submitLabel="Добавить артефакт"
        />
      ) : null}

      {mode === "link" ? (
        <MetadataForm
          initial={emptyDraft}
          label="Новый артефакт по ссылке"
          onCancel={() => {
            setMode(null);
          }}
          onSubmit={(draft) => {
            addLink.mutate(draft);
          }}
          pending={addLink.isPending}
          submitLabel="Добавить артефакт"
          withUrl
        />
      ) : null}

      {mode === null && candidates.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Взять артефакт из другого руководства
          </summary>
          <ul className="mt-2 grid gap-2">
            {candidates.map((artifact) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                key={artifact.artifactId}
              >
                <span className="text-sm">{artifact.title}</span>
                <Button
                  disabled={reuse.isPending}
                  onClick={() => {
                    reuse.mutate(artifact);
                  }}
                  type="button"
                  variant="outline"
                >
                  Добавить сюда
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function MetadataForm({
  hint,
  initial,
  label,
  onCancel,
  onSubmit,
  pending,
  submitLabel,
  withUrl = false,
}: {
  readonly hint?: string;
  readonly initial: Draft;
  readonly label: string;
  readonly onCancel: () => void;
  readonly onSubmit: (draft: Draft) => void;
  readonly pending: boolean;
  readonly submitLabel: string;
  readonly withUrl?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      aria-label={label}
      className="mt-3 grid gap-3 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      {hint === undefined ? null : (
        <p className="break-all text-xs text-muted-foreground">{hint}</p>
      )}
      <label className="block">
        <span className="text-xs text-muted-foreground">Название</span>
        <input
          className="mt-1 block w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
          maxLength={200}
          onChange={(event) => {
            setDraft({ ...draft, title: event.currentTarget.value });
          }}
          required
          type="text"
          value={draft.title}
        />
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">
          Зачем он читателю
        </span>
        <textarea
          className="mt-1 block w-full resize-y rounded-md border border-input bg-transparent px-2 py-1 text-sm"
          maxLength={1000}
          onChange={(event) => {
            setDraft({ ...draft, purpose: event.currentTarget.value });
          }}
          rows={2}
          value={draft.purpose}
        />
      </label>
      {withUrl ? (
        <label className="block">
          <span className="text-xs text-muted-foreground">Адрес</span>
          <input
            className="mt-1 block w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
            inputMode="url"
            onChange={(event) => {
              setDraft({ ...draft, externalUrl: event.currentTarget.value });
            }}
            required
            type="url"
            value={draft.externalUrl}
          />
        </label>
      ) : null}
      <fieldset className="grid gap-1">
        <legend className="text-xs text-muted-foreground">Кому доступен</legend>
        {(["membership", "free"] satisfies GuideArtifactAccess[]).map((value) => (
          <label className="flex items-center gap-2 text-sm" key={value}>
            <input
              checked={draft.access === value}
              onChange={() => {
                setDraft({ ...draft, access: value });
              }}
              type="radio"
              value={value}
            />
            {describeArtifactAccess(value)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} type="submit">
          {submitLabel}
        </Button>
        <Button onClick={onCancel} type="button" variant="ghost">
          Отмена
        </Button>
      </div>
    </form>
  );
}

function MutationNotice({
  result,
}: {
  readonly result: GuideArtifactMutationResult;
}) {
  switch (result.kind) {
    case "saved":
      return <span role="status">Артефакт «{result.artifact.title}» сохранён.</span>;
    case "removed":
      return <span role="status">Артефакт удалён.</span>;
    case "referenced":
      return (
        <span role="alert">
          Артефакт ещё используется в {guidesInWords(result.guideIds.length)}.
          Сначала уберите его оттуда.
        </span>
      );
    case "rejected":
      return <span role="alert">{result.reason}</span>;
    case "unauthorized":
      return <span role="alert">Не хватает прав на изменение артефактов.</span>;
    case "error":
      return (
        <span role="alert">
          Не удалось сохранить артефакт. Код: {result.reference}
        </span>
      );
  }
}
