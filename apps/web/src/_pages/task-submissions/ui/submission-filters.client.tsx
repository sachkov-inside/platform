"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { formatCountRu } from "@/shared/lib/moscow-format";
import { internalRoute } from "@/shared/routing/internal-route";
import { AdminFilterBar, type AdminFilterChip } from "@/shared/ui/admin";

import {
  feedbackOptions,
  productOptions,
  selectionForProduct,
  selectionForTask,
  selectionLabels,
  taskOptions,
  taskValue,
} from "../model/submissions-list";
import {
  defaultSubmissionsAddress,
  feedbackFilters,
  isDefaultView,
  submissionsListHref,
  type FeedbackFilter,
  type FilterProduct,
  type SubmissionSelection,
} from "../model/task-submissions";

/**
 * Server filters of «Сдачи» in the shared filter bar (#1717): Author Feedback, Product, and chapter
 * or task. Every choice is an address: it returns to the first page, keeps the Product-choice
 * continuation and the other filters. «Сбросить» opens the default view, new submissions of every
 * Product. Without `navigate` the bar moves the router itself, as in the loading state.
 */
export function SubmissionFilters({
  feedback,
  selection,
  products,
  productCursor,
  shownCount,
  firstProductsHref = null,
  nextProductsHref = null,
  navigate,
}: {
  readonly feedback: FeedbackFilter;
  readonly selection: SubmissionSelection;
  readonly products: readonly FilterProduct[];
  readonly productCursor?: string | undefined;
  /** Rows on this page; absent while the list loads. */
  readonly shownCount?: number;
  readonly firstProductsHref?: string | null;
  readonly nextProductsHref?: string | null;
  readonly navigate?: (href: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const go =
    navigate ??
    ((href: string) => {
      startTransition(() => {
        router.push(internalRoute(href));
      });
    });
  const open = (next: {
    readonly feedback?: FeedbackFilter;
    readonly selection?: SubmissionSelection;
  }) => {
    go(
      submissionsListHref({
        selection: next.selection ?? selection,
        feedback: next.feedback ?? feedback,
        productCursor,
      }),
    );
  };
  const labels = selectionLabels(selection, products);
  const chips: AdminFilterChip[] = [];
  if (feedback !== "all")
    chips.push({
      id: "feedback",
      label: feedback === "awaiting" ? "Без комментария" : "С комментарием",
      // «Без комментария» is the default view: it changes through the select, not a removal.
      ...(feedback === "awaiting"
        ? {}
        : {
            onRemove: () => {
              open({ feedback: "all" });
            },
          }),
    });
  if (labels.product !== undefined)
    chips.push({
      id: "product",
      label: labels.product,
      onRemove: () => {
        open({ selection: {} });
      },
    });
  if (labels.task !== undefined)
    chips.push({
      id: "task",
      label: labels.task,
      onRemove: () => {
        open({ selection: selectionForTask(selection, "") });
      },
    });
  return (
    <div className="submission-filters" data-submissions-part="filter">
      <AdminFilterBar
        chips={chips}
        filters={[
          {
            id: "feedback",
            label: "Комментарий автора",
            value: feedback,
            options: feedbackOptions,
            onChange: (value) => {
              const choice = feedbackFilters.find((item) => item === value);
              if (choice !== undefined) open({ feedback: choice });
            },
          },
          {
            id: "product",
            label: "Продукт",
            value: selection.productId ?? "all",
            options: productOptions(products),
            onChange: (value) => {
              open({ selection: selectionForProduct(value) });
            },
          },
          {
            id: "task",
            label: "Глава или задание",
            value: taskValue(selection),
            options: taskOptions(products, selection),
            onChange: (value) => {
              open({ selection: selectionForTask(selection, value) });
            },
          },
        ]}
        onReset={
          isDefaultView({ selection, feedback })
            ? undefined
            : () => {
                go(submissionsListHref(defaultSubmissionsAddress));
              }
        }
        resultLabel={
          shownCount === undefined
            ? undefined
            : `На странице: ${formatCountRu(shownCount, ["сдача", "сдачи", "сдач"])}`
        }
      />
      {firstProductsHref === null && nextProductsHref === null ? null : (
        <nav
          aria-label="Другие продукты в фильтре"
          className="submission-product-pages"
        >
          {firstProductsHref === null ? null : (
            <Link href={internalRoute(firstProductsHref)}>Первые продукты</Link>
          )}
          {nextProductsHref === null ? null : (
            <Link href={internalRoute(nextProductsHref)}>Другие продукты</Link>
          )}
        </nav>
      )}
    </div>
  );
}
