"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  MaterialTableName,
  OrderTableRange,
} from "../model/material-table-names";

interface OrderTablePlan {
  readonly scope: string;
  readonly ranges: readonly OrderTableRange[];
}

interface OrderTableShift {
  readonly scope: string;
  readonly by: number;
}

const OrderPlan = createContext<OrderTablePlan | null>(null);
const TableShifts = createContext<ReadonlyMap<string, number>>(new Map());

export function MaterialOrderTablePlan({
  scope,
  ranges,
  children,
}: OrderTablePlan & { readonly children: ReactNode }) {
  return <OrderPlan value={{ scope, ranges }}>{children}</OrderPlan>;
}

/** Number the shown steps, never the answer key supplied to the exercise (#2408). */
export function useShownOrderTableNames(
  ids: readonly string[],
): ReadonlyMap<string, OrderTableShift> {
  const plan = useContext(OrderPlan);
  const shifts = new Map<string, OrderTableShift>();
  if (plan === null) return shifts;
  let next = plan.ranges[0]?.start ?? 1;
  for (const id of ids) {
    const range = plan.ranges.find((item) => item.stepId === id);
    if (range === undefined) continue;
    shifts.set(id, { scope: plan.scope, by: next - range.start });
    next += range.count;
  }
  return shifts;
}

export function MaterialOrderStepTableNames({
  shift,
  children,
}: {
  readonly shift: OrderTableShift | undefined;
  readonly children: ReactNode;
}) {
  const inherited = useContext(TableShifts);
  if (shift === undefined) return children;
  const shifts = new Map(inherited);
  shifts.set(shift.scope, shift.by);
  return <TableShifts value={shifts}>{children}</TableShifts>;
}

export function useMaterialTableName(name?: MaterialTableName): string {
  const shifts = useContext(TableShifts);
  if (name === undefined || name.total === 1) return "Таблица в материале";
  const number = name.orderScopes.reduce(
    (value, scope) => value + (shifts.get(scope) ?? 0),
    name.number,
  );
  return `Таблица ${String(number)} в материале`;
}

export function MaterialTableCaption({
  name,
}: {
  readonly name: MaterialTableName | undefined;
}) {
  return <caption className="sr-only">{useMaterialTableName(name)}</caption>;
}
