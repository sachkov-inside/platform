"use client";

import { useSearchParams } from "next/navigation";

import { MaterialReaderNotFound } from "@/_pages/material-reader";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

/** Material reader not-found state. */
export default function MaterialNotFound() {
  return (
    <MaterialReaderNotFound
      returnTarget={parseMaterialReaderReturnTarget(
        useSearchParams().get("from"),
      )}
    />
  );
}
