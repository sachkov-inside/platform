"use client";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAutosave } from "@/shared/lib/autosave/use-autosave";
import {
  setContentCollectionArchive,
  updateContentCollection,
} from "../api/content-collections.browser";
import type {
  ContentCollection,
  ContentCollectionMutationResult,
  UpdateContentCollectionInput,
} from "./content-collections";
export function useCollectionDraft(
  collection: ContentCollection,
  onSaved: (result: ContentCollectionMutationResult) => void,
) {
  const [name, setName] = useState(collection.name);
  const [summary, setSummary] = useState(collection.summary);
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
    value: { name, summary },
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
    cover,
    setCover,
    version,
    update,
    archive,
    autosave,
  };
}
