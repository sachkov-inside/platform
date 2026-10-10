import "server-only";
import { z } from "zod";

import {
  BackendConnectionError,
  requestSalesFunnelReport,
} from "@/shared/api/backend/index.server";
import { readAuthenticatedSession } from "@/shared/auth/index.server";

import {
  presentSalesFunnelReport,
  readReportPeriod,
  salesFunnelReportSchema,
  type SalesFunnelReport,
  type SalesFunnelReportView,
} from "../model/sales-funnel-report";

export type SalesFunnelReportOutcome =
  | { readonly kind: "ready"; readonly view: SalesFunnelReportView }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" };

export interface SalesFunnelReportParams {
  readonly from?: string;
  readonly to?: string;
  readonly productId?: string;
  readonly chapterId?: string;
}

const problemSchema = z.object({ code: z.string() });
const idSchema = z.uuid();

type Attempt =
  | { readonly ok: true; readonly report: SalesFunnelReport }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string | null;
    };

/**
 * Отчёт воронки для `/authoring/sales-funnel`. Без выбранного продукта берётся первый; глава
 * другого продукта после смены выбора заменяется первой главой нового.
 */
export async function loadSalesFunnelReport(
  params: SalesFunnelReportParams,
): Promise<SalesFunnelReportOutcome> {
  const session = await readAuthenticatedSession("rsc");
  if (session.kind !== "ready") {
    if (session.kind === "authentication_required")
      return { kind: "unauthorized" };
    throw new Error("Identity session is unavailable");
  }
  const accessToken = session.value;
  const period = readReportPeriod(params, new Date());
  const read = async (selection: {
    readonly productId?: string;
    readonly chapterId?: string;
  }): Promise<Attempt> => {
    let result;
    try {
      result = await requestSalesFunnelReport(
        { ...period.query, ...selection },
        accessToken,
      );
    } catch (error) {
      if (error instanceof BackendConnectionError)
        return { ok: false, status: 503, code: null };
      throw error;
    }
    if (!result.ok)
      return {
        ok: false,
        status: result.response.status,
        code: problemSchema.safeParse(result.problem).data?.code ?? null,
      };
    const parsed = salesFunnelReportSchema.safeParse(result.body);
    return parsed.success
      ? { ok: true, report: parsed.data }
      : { ok: false, status: 502, code: null };
  };

  const productId = idSchema.safeParse(params.productId).data;
  const chapterId =
    productId === undefined
      ? undefined
      : idSchema.safeParse(params.chapterId).data;
  let attempt = await read({
    ...(productId === undefined ? {} : { productId }),
    ...(chapterId === undefined ? {} : { chapterId }),
  });
  if (
    !attempt.ok &&
    attempt.code === "chapter_not_found" &&
    productId !== undefined
  )
    attempt = await read({ productId });
  if (!attempt.ok && attempt.code === "product_not_found")
    attempt = await read({});
  if (attempt.ok && attempt.report.selection === null) {
    const first = attempt.report.products[0];
    if (first !== undefined) attempt = await read({ productId: first.id });
  }
  if (!attempt.ok) {
    if (attempt.status === 401) return { kind: "unauthorized" };
    if (attempt.status === 403) return { kind: "forbidden" };
    return { kind: "unavailable" };
  }
  return {
    kind: "ready",
    view: presentSalesFunnelReport(attempt.report, period),
  };
}
