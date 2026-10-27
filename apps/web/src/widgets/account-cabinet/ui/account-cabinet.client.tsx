"use client";
import type { ReactNode } from "react";
export interface AccountCabinetProps {
  readonly children: ReactNode;
}
export function AccountCabinet({ children }: AccountCabinetProps) {
  return <div className="mx-auto w-full max-w-3xl pb-8">{children}</div>;
}
