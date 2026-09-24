"use client";

import { useEffect } from "react";

import type { RenderErrorReport } from "../model/client-telemetry-contract";
import { reportRenderError } from "./client-telemetry.browser";

/** Граница ошибок сообщает о пойманном сбое один раз на каждую новую ошибку. */
export function useRenderErrorReport(
  boundary: RenderErrorReport["boundary"],
  error: Error & { readonly digest?: string },
): void {
  useEffect(() => {
    reportRenderError(boundary, error);
  }, [boundary, error]);
}
