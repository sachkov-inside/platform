"use client";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { flushPendingEdits, useAutosave } from "@/shared/lib/autosave/use-autosave";
import {
  setContentCollectionArchive,
  updateContentCollection,
} from "../api/content-collections.browser";
import type {
  ContentCollection,
  ContentCollectionMutationResult,
  GuideIntroductionDraft,
  UpdateContentCollectionInput,
} from "./content-collections";

const EMPTY_INTRODUCTION: GuideIntroductionDraft = {
  audience: "",
  outcome: "",
  prerequisites: "",
  scope: "",
};

export function useCollectionDraft(
  collection: ContentCollection,
  onSaved: (result: ContentCollectionMutationResult) => void,
  /** A surface that does not edit the introduction leaves the stored text alone. */
  options: { readonly editsIntroduction?: boolean } = {},
) {
  const [name, setName] = useState(collection.name);
  const [summary, setSummary] = useState(collection.summary);
  const [introduction, setIntroduction] = useState(
    collection.introduction ?? EMPTY_INTRODUCTION,
  );
  const [cover, setCover] = useState(collection.cover ?? null);
  const version = useRef(collection.version);
  const attempted = useRef<UpdateContentCollectionInput | null>(null);
  const update = useMutation({ mutationFn: updateContentCollection });
  const archive = useMutation({
    mutationFn: setContentCollectionArchive,
    onSuccess: (result) => {
      if (result.kind === "saved") version.current = result.collection.version;
      onSaved(result);
    },
  });
  const autosave = useAutosave({
    value: options.editsIntroduction === true
      ? { introduction, name, summary }
      : { name, summary },
    enabled: name.trim().length > 0,
    save: async (value) => {
      const input = attempted.current ?? {
        ...value,
        collectionId: collection.id,
        expectedVersion: version.current,
        kind: collection.kind,
      };
      attempted.current = input;
      const result = await update.mutateAsync(input);
      if (result.kind === "saved") {
        version.current = result.collection.version;
        attempted.current = null;
        onSaved(result);
        return "saved";
      }
      if (result.kind === "invalid") {
        attempted.current = null;
        return "invalid";
      }
      return "failed";
    },
  });
  return {
    name,
    setName,
    summary,
    setSummary,
    introduction,
    editIntroduction: (field: keyof GuideIntroductionDraft, value: string) => {
      setIntroduction((current) => ({ ...current, [field]: value }));
    },
    cover,
    setCover,
    update,
    archive,
    autosave,
    setArchived: (archived: boolean) => {
      void flushPendingEdits().then((ok) => {
        if (ok) archive.mutate({
          archived,
          collectionId: collection.id,
          expectedVersion: version.current,
          kind: collection.kind,
        });
      });
    },
  };
}
