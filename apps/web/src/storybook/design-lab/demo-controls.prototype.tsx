import type { ReactNode } from "react";

export function DemoControls({ children }: { readonly children: ReactNode }) {
  return (
    <div className="lab-demo" aria-label="Демонстрационные состояния">
      <span>Состояние примера</span>
      {children}
    </div>
  );
}
