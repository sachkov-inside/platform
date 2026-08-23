import Link from "next/link";
import type { ReactNode } from "react";

import { GlobalNavigation } from "@/widgets/global-navigation";

interface AppShellProps {
  readonly children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Перейти к содержанию
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand-link" href="/">
            Inside
          </Link>
          <GlobalNavigation />
        </div>
      </header>
      <main className="page-main" id="content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">Дом материалов Sachkov Inside</footer>
    </div>
  );
}
