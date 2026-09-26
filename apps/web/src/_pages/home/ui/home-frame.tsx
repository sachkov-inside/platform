import type { ReactNode } from "react";
import "./home-page.css";

export function HomeFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="home-page @container/home min-w-0">
      <h1 className="sr-only">Главная</h1>
      {children}
    </div>
  );
}
